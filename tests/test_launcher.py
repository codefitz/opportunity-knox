"""Host-side configuration tests; no running Docker or personal folders needed."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "scripts" / "launcher.py"
spec = importlib.util.spec_from_file_location("board_launcher", MODULE)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.state = self.root / "app state"
        self.state.mkdir()
        self.files = self.root / "Applications with spaces"
        self.files.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def args(self, *extra):
        return launcher.parse_args(["start", "--files", str(self.files), "--state-dir", str(self.state), *extra])

    def save(self, config):
        launcher.atomic_json(self.state / "launcher.json", config)

    def test_source_fingerprint_detects_edits_additions_deletions_but_not_runtime_data(self):
        repo = self.root / "repo"
        (repo / "src").mkdir(parents=True)
        source = repo / "src" / "App.tsx"
        source.write_text("original")
        first = launcher.source_status(repo)["sourceHash"]
        (repo / ".local").mkdir()
        (repo / ".local" / "private.sqlite").write_text("private")
        (repo / "docs").mkdir()
        (repo / "docs" / "note.md").write_text("documentation")
        self.assertEqual(launcher.source_status(repo)["sourceHash"], first)
        source.write_text("edited")
        self.assertNotEqual(launcher.source_status(repo)["sourceHash"], first)
        source.write_text("original")
        extra = repo / "src" / "new.ts"
        extra.write_text("new")
        self.assertNotEqual(launcher.source_status(repo)["sourceHash"], first)
        extra.unlink()
        self.assertEqual(launcher.source_status(repo)["sourceHash"], first)
        source.unlink()
        self.assertNotEqual(launcher.source_status(repo)["sourceHash"], first)

    def test_compose_records_immutable_build_baseline_and_host_observation(self):
        config, _ = launcher.make_config(self.args(), self.state)
        source = {"sourceHash": "a" * 64, "commit": "b" * 40, "dirty": True, "checkedAt": 123}
        with patch.object(launcher, "source_status", return_value=source):
            service = launcher.compose_override(config, self.state, "test")["services"]["board"]
        self.assertEqual(service["build"]["args"]["BOARD_BUILD_SOURCE_HASH"], source["sourceHash"])
        self.assertEqual(service["build"]["args"]["BOARD_BUILD_COMMIT"], source["commit"])
        self.assertEqual(launcher.read_json(self.state / "source-status.json"), source)
        self.assertNotIn("BOARD_BUILD_SOURCE_HASH", service["environment"])
        self.assertEqual(service["build"]["args"]["BOARD_BUILD_DIRTY"], "1")

    def test_flags_and_default_command(self):
        self.assertEqual(launcher.parse_args([]).command, "start")
        args = self.args("--port", "9418", "--bind", "0.0.0.0", "--no-open")
        self.assertEqual((args.port, args.bind, args.no_open), (9418, "0.0.0.0", True))
        for argv in (["start", "--port", "0"], ["start", "--bind", "not a host"], ["stop", "--files", str(self.files)]):
            with self.assertRaises(SystemExit):
                launcher.parse_args(argv)

    def test_defaults_create_only_the_initial_default_folder(self):
        home = self.root / "home"
        home.mkdir()
        with patch.object(launcher.Path, "home", return_value=home):
            config, pending = launcher.make_config(launcher.parse_args(["start"]), self.state)
        self.assertFalse(pending)
        self.assertEqual(config["files"], str(home / "OpportunityBoard"))
        self.assertTrue((home / "OpportunityBoard").is_dir())
        self.assertEqual(config["port"], 4318)
        self.assertEqual(config["bind"], "127.0.0.1")

    def test_spaces_metacharacters_and_dollar_signs_remain_literal(self):
        folder = self.root / 'applications $HOME `not a command`'
        folder.mkdir()
        config, _ = launcher.make_config(self.args("--files", str(folder)), self.state)
        override = launcher.compose_override(config, self.state, "not-secret-test-token")
        service = override["services"]["board"]
        self.assertEqual(service["volumes"][1]["source"], str(folder).replace("$", "$$"))
        self.assertEqual(service["environment"]["BOARD_HOST_FILES_DIR"], str(folder).replace("$", "$$"))
        # Structured JSON serialization never invokes shell parsing.
        self.assertEqual(json.loads(json.dumps(override)), override)

    def test_container_runs_as_host_user_on_unix(self):
        config, _ = launcher.make_config(self.args(), self.state)
        with patch.object(launcher.os, "getuid", return_value=1001), patch.object(launcher.os, "getgid", return_value=1002):
            override = launcher.compose_override(config, self.state, "test")
        self.assertEqual(override["services"]["board"]["user"], "1001:1002")

    def test_failed_start_retains_saved_config_and_pending_request(self):
        config, _ = launcher.make_config(self.args(), self.state)
        self.save(config)
        old_override = launcher.compose_override(config, self.state, "test")
        launcher.atomic_json(self.state / "runtime.compose.json", old_override)
        new = self.root / "New documents"
        new.mkdir()
        launcher.atomic_json(self.state / "pending-storage.json", {"hostPath": str(new)})
        with patch.object(launcher, "ensure_docker"), patch.object(launcher, "run", side_effect=launcher.LauncherError("simulated failure")):
            with self.assertRaisesRegex(launcher.LauncherError, "simulated failure"):
                launcher.main(["restart", "--state-dir", str(self.state), "--no-open"])
        self.assertEqual(launcher.read_json(self.state / "launcher.json"), config)
        self.assertEqual(launcher.read_json(self.state / "runtime.compose.json"), old_override)
        self.assertTrue((self.state / "pending-storage.json").exists())

    def test_pending_folder_preserves_previous_container_mount(self):
        config, _ = launcher.make_config(self.args(), self.state)
        old_mount = launcher.mount_path(config["files"])
        self.save(config)
        new = self.root / "New documents"
        new.mkdir()
        launcher.atomic_json(self.state / "pending-storage.json", {"hostPath": str(new)})
        updated, has_pending = launcher.make_config(launcher.parse_args(["restart"]), self.state)
        self.assertTrue(has_pending)
        self.assertEqual(updated["files"], str(new))
        override = launcher.compose_override(updated, self.state, "test")
        service = override["services"]["board"]
        mounts = service["volumes"]
        self.assertEqual(mounts[1]["target"], old_mount)
        self.assertTrue(mounts[1]["read_only"])
        self.assertEqual(service["environment"]["BOARD_FILES_DIR"], launcher.mount_path(str(new)))
        self.assertEqual(len(json.loads(service["environment"]["BOARD_DOCUMENT_ROOTS"])), 2)
        self.assertFalse(mounts[-1]["read_only"])
        self.assertFalse(mounts[-1]["bind"]["create_host_path"])

    def test_explicit_missing_folder_is_not_created(self):
        absent = self.root / "Disconnected drive" / "Applications"
        with self.assertRaises(launcher.LauncherError):
            launcher.make_config(self.args("--files", str(absent)), self.state)
        self.assertFalse(absent.exists())

    def test_saved_missing_folder_does_not_reset_to_default(self):
        config, _ = launcher.make_config(self.args(), self.state)
        self.save(config)
        self.files.rmdir()
        with self.assertRaisesRegex(launcher.LauncherError, "unavailable"):
            launcher.make_config(launcher.parse_args(["start"]), self.state)

    def test_invalid_pending_request_leaves_config_unchanged(self):
        config, _ = launcher.make_config(self.args(), self.state)
        self.save(config)
        original = (self.state / "launcher.json").read_bytes()
        launcher.atomic_json(self.state / "pending-storage.json", {"hostPath": "relative-path"})
        with self.assertRaisesRegex(launcher.LauncherError, "absolute"):
            launcher.make_config(launcher.parse_args(["restart"]), self.state)
        self.assertEqual((self.state / "launcher.json").read_bytes(), original)
        self.assertTrue((self.state / "pending-storage.json").exists())

    def test_token_is_persistent_and_owner_readable_only(self):
        token = launcher.setup_token(self.state)
        self.assertGreaterEqual(len(token), 32)
        self.assertEqual(launcher.setup_token(self.state), token)
        self.assertEqual((self.state / ".setup-token").stat().st_mode & 0o777, 0o600)

    def test_no_docker_prerequisite_error(self):
        with patch.object(launcher.shutil, "which", return_value=None):
            with self.assertRaisesRegex(launcher.LauncherError, "Docker is not installed"):
                launcher.ensure_docker()

    def test_compose_arguments_are_separate_for_paths_with_spaces(self):
        args = launcher.compose_command(self.state)
        self.assertIn(str(self.state / "runtime.compose.json"), args)
        self.assertEqual(args[0:2], ["docker", "compose"])
        self.assertEqual(args[args.index("--project-name") + 1], "opportunity-board")

    def test_url_for_ipv4_and_ipv6(self):
        self.assertEqual(launcher.base_url({"bind": "0.0.0.0", "port": 4318}), "http://127.0.0.1:4318")
        self.assertEqual(launcher.base_url({"bind": "::1", "port": 4318}), "http://[::1]:4318")

    def test_status_does_not_create_state(self):
        missing = self.root / "not-created"
        with patch.object(launcher, "ensure_docker") as docker:
            result = launcher.main(["status", "--state-dir", str(missing)])
        self.assertEqual(result, 0)
        self.assertFalse(missing.exists())
        docker.assert_not_called()

    def test_read_only_vault_is_mounted_without_a_write_probe(self):
        config, _ = launcher.make_config(self.args(), self.state)
        self.save(config)
        vault = self.root / "fictional vault"
        vault.mkdir()
        (vault / "original.md").write_text("fictional", encoding="utf-8")
        launcher.atomic_json(self.state / "pending-vault.json", {"hostPath": str(vault), "create": False, "readOnly": True})
        original_host_folder = launcher.host_folder
        calls = []
        def spy(raw, *, writable=True):
            calls.append((raw, writable))
            return original_host_folder(raw, writable=writable)
        with patch.object(launcher, "host_folder", side_effect=spy):
            updated, _ = launcher.make_config(launcher.parse_args(["restart"]), self.state)
        self.assertTrue(all(not writable for raw, writable in calls if raw == str(vault)))
        service = launcher.compose_override(updated, self.state, "test")["services"]["board"]
        mount = next(m for m in service["volumes"] if m["target"] == "/vault")
        self.assertTrue(mount["read_only"])
        self.assertEqual(service["environment"]["BOARD_VAULT_READ_ONLY"], "1")
        self.assertEqual([p.name for p in vault.iterdir()], ["original.md"])

    def test_watcher_reports_failed_restart_without_losing_pending_mount(self):
        launcher.atomic_json(self.state / "pending-vault.json", {"hostPath": "/fictional", "readOnly": True})
        launcher.atomic_json(self.state / "pending-restart.json", {"requestId": "test-id"})
        with patch.object(launcher, "main", side_effect=launcher.LauncherError("simulated restart failure")):
            launcher.watch_loop(self.state, once=True)
        status = launcher.read_json(self.state / "restart-status.json")
        self.assertEqual(status, {"requestId": "test-id", "state": "failed", "message": "simulated restart failure"})
        self.assertTrue((self.state / "pending-vault.json").exists())

    def test_watch_loop_applies_pending_restart_handoff(self):
        launcher.atomic_json(self.state / "pending-restart.json", {"requestedAt": "2026-10-27T11:00:00Z"})
        calls = []
        with patch.object(launcher, "main", side_effect=lambda argv: calls.append(argv) or 0):
            result = launcher.watch_loop(self.state, once=True)
        self.assertEqual(result, 0)
        self.assertFalse((self.state / "pending-restart.json").exists())
        self.assertEqual(calls, [["restart", "--state-dir", str(self.state.resolve()), "--no-open", "--no-watch"]])

    def test_pending_vault_creates_and_mounts_host_vault(self):
        config, _ = launcher.make_config(self.args(), self.state)
        self.save(config)
        vault_dir = self.root / "My Obsidian Vault"
        launcher.atomic_json(self.state / "pending-vault.json", {"hostPath": str(vault_dir), "create": True})
        updated, has_pending = launcher.make_config(launcher.parse_args(["restart"]), self.state)
        self.assertTrue(has_pending)
        self.assertTrue(vault_dir.is_dir())
        self.assertEqual(updated["vault"], str(vault_dir))
        override = launcher.compose_override(updated, self.state, "test")
        service = override["services"]["board"]
        self.assertEqual(service["environment"]["BOARD_VAULT_DIR"], "/vault")
        self.assertEqual(service["environment"]["BOARD_HOST_VAULT_DIR"], str(vault_dir))
        self.assertEqual(service["volumes"][-1]["target"], "/vault")
        self.assertFalse(service["volumes"][-1]["read_only"])

    def test_independent_sources_generate_readonly_mounts_without_modifying_originals(self):
        archive=self.root/'Career archive';archive.mkdir();original=archive/'fictional.txt';original.write_text('Fictional evidence')
        launcher.atomic_json(self.state/'pending-sources.json',{'roots':[{'id':'fictional-source','name':'Career archive','hostPath':str(archive)}]})
        config,_=launcher.make_config(self.args(),self.state);override=launcher.compose_override(config,self.state,'fictional-token');service=override['services']['board'];mounts=[m for m in service['volumes'] if m['target'].startswith('/sources/')]
        self.assertEqual(len(mounts),1);self.assertTrue(mounts[0]['read_only']);self.assertEqual(original.read_text(),'Fictional evidence');self.assertIn('BOARD_SOURCE_ROOTS',service['environment'])

    def test_source_overlap_with_application_data_is_refused(self):
        launcher.atomic_json(self.state/'pending-sources.json',{'roots':[{'id':'bad','name':'bad','hostPath':str(self.root)}]})
        with self.assertRaises(launcher.LauncherError):launcher.make_config(self.args(),self.state)


if __name__ == "__main__":
    unittest.main()

class PreUpgradeBackupTests(unittest.TestCase):
    setUp = LauncherTests.setUp
    tearDown = LauncherTests.tearDown
    args = LauncherTests.args
    save = LauncherTests.save
    def populate(self, corrupt=False):
        import sqlite3,hashlib
        config,_=launcher.make_config(self.args(),self.state);self.save(config)
        launcher.atomic_json(self.state/'runtime.compose.json',launcher.compose_override(config,self.state,'fictional-token'))
        doc_id='12345678-1234-4234-8234-123456789abc';path=self.files/'fictional.txt';path.write_bytes(b'Fictional original')
        db=sqlite3.connect(self.state/'board.sqlite')
        for table,key in [('config','key'),('documents','id'),('records','id')]:db.execute(f'CREATE TABLE {table}({key} TEXT PRIMARY KEY,data TEXT NOT NULL)')
        doc={'id':doc_id,'name':'fictional.txt','storageRoot':launcher.mount_path(str(self.files)),'relativePath':'fictional.txt','sha256':'bad' if corrupt else hashlib.sha256(path.read_bytes()).hexdigest()}
        db.execute('INSERT INTO documents VALUES(?,?)',(doc_id,json.dumps(doc)));db.commit();db.close()
        return config
    def test_upgrade_creates_verified_full_snapshot_before_rebuild(self):
        self.populate()
        with patch.object(launcher,'ensure_docker'),patch.object(launcher,'fetch_json',return_value={'setupRequired':False}),patch.object(launcher,'run',return_value=subprocess.CompletedProcess([],0,stdout='',stderr='')) as run:
            launcher.main(['restart','--state-dir',str(self.state),'--no-open','--no-watch'])
        result=launcher.read_json(self.state/'last-upgrade-backup.json');self.assertTrue((Path(result['location'])/'board.sqlite').exists());self.assertEqual((Path(result['location'])/'documents'/'12345678-1234-4234-8234-123456789abc').read_bytes(),b'Fictional original')
        commands=[c.args[0] for c in run.call_args_list];stop=next(i for i,c in enumerate(commands) if c[-2:]==['stop','board']);build=next(i for i,c in enumerate(commands) if '--build' in c);self.assertLess(stop,build)
    def test_failed_verification_prevents_build_and_restarts_previous_service(self):
        self.populate(corrupt=True)
        with patch.object(launcher,'ensure_docker'),patch.object(launcher,'run',return_value=subprocess.CompletedProcess([],0,stdout='',stderr='')) as run:
            with self.assertRaises(launcher.LauncherError):launcher.main(['restart','--state-dir',str(self.state),'--no-open','--no-watch'])
        self.assertFalse(any('--build' in c.args[0] for c in run.call_args_list));self.assertTrue(any(c.args[0][-2:]==['start','board'] for c in run.call_args_list))
    def test_failed_rebuild_reinstates_the_previous_image(self):
        self.populate()
        def command(cmd,**kwargs):
            if '--build' in cmd:raise launcher.LauncherError('Fictional build failure')
            return subprocess.CompletedProcess(cmd,0,stdout='sha256:fictional-image' if 'images' in cmd else '',stderr='')
        with patch.object(launcher,'ensure_docker'),patch.object(launcher,'run',side_effect=command) as run:
            with self.assertRaises(launcher.LauncherError):launcher.main(['restart','--state-dir',str(self.state),'--no-open','--no-watch'])
        self.assertTrue(any(c.args[0]==['docker','tag','sha256:fictional-image',launcher.PROJECT+'-board:latest'] for c in run.call_args_list))
        self.assertTrue(any('--no-build' in c.args[0] for c in run.call_args_list))
