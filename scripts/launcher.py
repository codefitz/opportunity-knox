#!/usr/bin/env python3
"""Small host-side Docker launcher; uses only the Python standard library."""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser

REPO = Path(__file__).resolve().parents[1]
PROJECT = "opportunity-board"
sys.path.insert(0, str(Path(__file__).resolve().parent))


class LauncherError(Exception):
    pass


def default_state_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "OpportunityBoard"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / PROJECT


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".board-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
        os.chmod(name, 0o600)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("expected an object")
        return data
    except (OSError, ValueError) as exc:
        raise LauncherError(f"Cannot read saved settings at {path}: {exc}") from exc


def host_folder(raw: str, *, writable: bool = True) -> str:
    if not isinstance(raw, str) or not raw.strip() or "\x00" in raw or "\n" in raw or "\r" in raw:
        raise LauncherError("Choose a valid host folder path.")
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        raise LauncherError("Document locations must be absolute paths on the hosting machine.")
    try:
        folder = candidate.resolve(strict=True)
    except OSError as exc:
        raise LauncherError(f"Document folder is unavailable: {candidate}. Reconnect its drive or choose an existing folder.") from exc
    if not folder.is_dir():
        raise LauncherError(f"Document location is not a folder: {folder}")
    if not os.access(folder, os.R_OK | os.X_OK):
        raise LauncherError(f"Document folder is not readable: {folder}")
    if writable:
        try:
            fd, probe = tempfile.mkstemp(prefix=".board-write-check-", dir=folder)
            os.close(fd)
            os.unlink(probe)
        except OSError as exc:
            raise LauncherError(f"Document folder is not writable: {folder}. Check its permissions.") from exc
    return str(folder)


def mount_path(host_path: str) -> str:
    return "/files/" + hashlib.sha256(host_path.encode("utf-8")).hexdigest()[:16]


def validate_bind(value: str) -> str:
    try:
        ipaddress.ip_address(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use a host IP address, such as 127.0.0.1 or a private VPN address.") from exc
    return value


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Start or stop your Opportunity Knox without managing Docker.")
    parser.add_argument("command", nargs="?", default="start", choices=["start", "stop", "restart", "status", "logs", "watch"])
    parser.add_argument("--files", help="Existing document folder on the hosting machine; remembered for future starts")
    parser.add_argument("--port", type=int, help="Browser port (default: 4318)")
    parser.add_argument("--bind", type=validate_bind, help="Host IP to bind (default: 127.0.0.1)")
    parser.add_argument("--no-open", action="store_true", help="Show the URL without opening a browser")
    parser.add_argument("--no-watch", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--state-dir", type=Path, default=Path(os.environ.get("BOARD_STATE_DIR", str(default_state_dir()))), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.port is not None and not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if args.command in ("stop", "status", "logs", "watch") and (args.files or args.port is not None or args.bind):
        parser.error("Folder, port and bind changes apply with start or restart.")
    return args


def make_config(args, state_dir: Path) -> tuple[dict, bool]:
    config_path = state_dir / "launcher.json"
    initial = not config_path.exists()
    if initial:
        default_files = Path.home() / "OpportunityBoard"
        if not args.files:
            default_files.mkdir(parents=True, exist_ok=True)
        current = host_folder(args.files or str(default_files))
        config = {"version": 1, "files": current, "roots": [current], "port": 4318, "bind": "127.0.0.1"}
    else:
        config = read_json(config_path)
        if (config.get("version") != 1 or not isinstance(config.get("roots"), list)
                or not isinstance(config.get("files"), str) or not isinstance(config.get("bind"), str)):
            raise LauncherError("Saved launcher settings use an unsupported format. Keep this state folder and inspect launcher.json.")
        config = dict(config, roots=list(config["roots"]))
    pending_path = state_dir / "pending-storage.json"
    pending = None
    if pending_path.exists():
        pending = read_json(pending_path).get("hostPath")
        if not isinstance(pending, str) or not pending.strip():
            raise LauncherError("The pending document-folder request has no valid hostPath. Correct it in Settings before restarting.")
    requested = args.files if args.files is not None else pending
    if requested is not None:
        current = host_folder(requested)
        config["files"] = current
        if current not in config["roots"]:
            config["roots"].append(current)
    config["files"] = host_folder(config["files"])
    # Keep old locations at their original container paths for recorded documents.
    config["roots"] = list(dict.fromkeys(host_folder(root, writable=(root == config["files"])) for root in config["roots"]))
    if config["files"] not in config["roots"]:
        config["roots"].append(config["files"])
    pending_vault_path = state_dir / "pending-vault.json"
    if pending_vault_path.exists():
        vault_req = read_json(pending_vault_path)
        vault_raw = vault_req.get("hostPath")
        if vault_raw == "":
            config.pop("vault", None)
            config.pop("vaultReadOnly", None)
        elif isinstance(vault_raw, str) and vault_raw.strip():
            candidate_vault = Path(vault_raw).expanduser()
            if not candidate_vault.is_absolute():
                raise LauncherError("Obsidian vault locations must be absolute paths on the hosting machine.")
            read_only = bool(vault_req.get("readOnly", not vault_req.get("create")))
            config["vaultReadOnly"] = read_only
            if bool(vault_req.get("create")) and read_only:
                raise LauncherError("A new vault cannot be created in read-only mode.")
            if bool(vault_req.get("create")):
                try:
                    candidate_vault.mkdir(parents=True, exist_ok=True)
                except OSError as exc:
                    raise LauncherError(f"Could not create Obsidian vault folder at {candidate_vault}: {exc}") from exc
            config["vault"] = host_folder(str(candidate_vault), writable=not read_only)
        else:
            raise LauncherError("The pending Obsidian vault request has no valid hostPath.")
    if config.get("vault"):
        config["vault"] = host_folder(config["vault"], writable=not config.get("vaultReadOnly", False))
        if config.get("vaultReadOnly") and (Path(config["vault"]) == Path(config["files"]) or Path(config["files"]) in Path(config["vault"]).parents or Path(config["vault"]) in Path(config["files"]).parents):
            raise LauncherError("A read-only vault must be outside the writable document folder.")
    sources_path=state_dir / "pending-sources.json"
    if sources_path.exists():
        requested_sources=read_json(sources_path).get("roots")
        if not isinstance(requested_sources,list) or len(requested_sources)>20:raise LauncherError("Invalid read-only source-folder request.")
        config["sourceRoots"]=requested_sources
    checked=[]
    for source in config.get("sourceRoots",[]):
        if not isinstance(source,dict) or not isinstance(source.get("id"),str) or not source["id"] or not isinstance(source.get("name"),str):raise LauncherError("Invalid source-folder identity.")
        location=host_folder(source.get("hostPath",""),writable=False)
        candidate=Path(location)
        for protected in [state_dir,*map(Path,config["roots"])]:
            protected=protected.resolve()
            if candidate==protected or candidate in protected.parents or protected in candidate.parents:raise LauncherError("Read-only sources must be separate from application data and managed documents.")
        checked.append({"id":source["id"],"name":source["name"],"hostPath":location})
    config["sourceRoots"]=checked
    if args.port is not None:
        config["port"] = args.port
    if args.bind:
        config["bind"] = args.bind
    try:
        validate_bind(config["bind"])
        if not isinstance(config["port"], int) or not 1 <= config["port"] <= 65535:
            raise ValueError("invalid port")
    except (ValueError, argparse.ArgumentTypeError, KeyError) as exc:
        raise LauncherError("Saved port or bind address is invalid. Use --port and --bind to set them.") from exc
    return config, (pending_path.exists() or pending_vault_path.exists() or sources_path.exists())


def setup_token(state_dir: Path) -> str:
    path = state_dir / ".setup-token"
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    token = secrets.token_urlsafe(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(token)
    return token


def compose_override(config: dict, state_dir: Path, token: str) -> dict:
    roots = config["roots"]
    vault_host = config.get("vault")
    mounts = [{"type": "bind", "source": str(state_dir), "target": "/data", "bind": {"create_host_path": False}}]
    mounts += [{"type": "bind", "source": root, "target": mount_path(root), "read_only": (root != config["files"] and (root != vault_host or config.get("vaultReadOnly", False))), "bind": {"create_host_path": False}} for root in roots]
    env = {"BOARD_DATA_DIR": "/data", "BOARD_FILES_DIR": mount_path(config["files"]), "BOARD_HOST_FILES_DIR": config["files"], "BOARD_DOCUMENT_ROOTS": json.dumps([mount_path(root) for root in roots]), "BOARD_SETUP_TOKEN": token}
    if vault_host:
        if vault_host in roots and not config.get("vaultReadOnly", False):
            vault_target = mount_path(vault_host)
        else:
            vault_target = "/vault"
            mounts.append({"type": "bind", "source": vault_host, "target": "/vault", "read_only": bool(config.get("vaultReadOnly", False)), "bind": {"create_host_path": False}})
        env["BOARD_VAULT_DIR"] = vault_target
        env["BOARD_HOST_VAULT_DIR"] = vault_host
        env["BOARD_VAULT_READ_ONLY"] = "1" if config.get("vaultReadOnly", False) else "0"
    source_mounts=[]
    for source in config.get("sourceRoots",[]):
        target="/sources/"+hashlib.sha256(source["hostPath"].encode()).hexdigest()[:16]
        mounts.append({"type":"bind","source":source["hostPath"],"target":target,"read_only":True,"bind":{"create_host_path":False}})
        source_mounts.append({**source,"path":target})
    env["BOARD_SOURCE_ROOTS"]=json.dumps(source_mounts)
    override = {"services": {"board": {
        "ports": [{"target": 4318, "published": str(config["port"]), "host_ip": config["bind"], "protocol": "tcp"}],
        "environment": env,
        "volumes": mounts,
    }}}
    if os.name == "posix":
        override["services"]["board"]["user"] = f"{os.getuid()}:{os.getgid()}"
    return escape_compose(override)


def escape_compose(value):
    """Compose interpolates dollar signs even in JSON; preserve host paths literally."""
    if isinstance(value, str):
        return value.replace("$", "$$")
    if isinstance(value, list):
        return [escape_compose(item) for item in value]
    if isinstance(value, dict):
        return {key: escape_compose(item) for key, item in value.items()}
    return value


def run(command, *, capture=False, check=True):
    try:
        result = subprocess.run(command, text=True, capture_output=capture, check=False)
    except OSError as exc:
        raise LauncherError(f"Could not run {command[0]}: {exc}") from exc
    if check and result.returncode:
        detail = (result.stderr or result.stdout or "").strip() if capture else ""
        raise LauncherError(detail or "The service could not be started. Run ./board logs for details. Check Docker folder-sharing permissions if a mount failed.")
    return result


def ensure_docker(*, auto_start=True) -> None:
    if not shutil.which("docker"):
        raise LauncherError("Docker is not installed. Install Docker Desktop (Mac) or Docker Engine with Compose (Linux), then run ./board start again.")
    if run(["docker", "compose", "version"], capture=True, check=False).returncode:
        raise LauncherError("Docker Compose is unavailable. Enable/install the Docker Compose plugin, then try again.")
    if run(["docker", "info"], capture=True, check=False).returncode == 0:
        return
    if auto_start and sys.platform == "darwin" and Path("/Applications/Docker.app").exists():
        print("Starting Docker Desktop…", flush=True)
        run(["open", "/Applications/Docker.app"], capture=True)
        for _ in range(45):
            time.sleep(1)
            if run(["docker", "info"], capture=True, check=False).returncode == 0:
                return
    raise LauncherError("Docker is not running. Start Docker Desktop or the Docker service on this host, then run ./board start again.")


def compose_command(state_dir: Path) -> list[str]:
    return ["docker", "compose", "--project-name", PROJECT, "-f", str(REPO / "compose.yaml"), "-f", str(state_dir / "runtime.compose.json")]


def base_url(config: dict) -> str:
    address = config["bind"]
    if address in ("0.0.0.0", "::"):
        address = "127.0.0.1"
    if ":" in address:
        address = f"[{address}]"
    return f"http://{address}:{config['port']}"


def fetch_json(url: str, timeout=2) -> dict | None:
    try:
        with urlopen(url, timeout=timeout) as response:
            return json.load(response)
    except (OSError, ValueError, URLError):
        return None


def stop_watcher(state_dir: Path) -> None:
    pid_path = state_dir / ".watcher.pid"
    if not pid_path.exists():
        return
    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip())
        if pid != os.getpid():
            os.kill(pid, signal.SIGTERM)
    except (OSError, ValueError):
        pass
    pid_path.unlink(missing_ok=True)


def start_watcher(state_dir: Path) -> None:
    stop_watcher(state_dir)
    try:
        proc = subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "watch", "--state-dir", str(state_dir)],
            start_new_session=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        (state_dir / ".watcher.pid").write_text(f"{proc.pid}\n", encoding="utf-8")
    except OSError:
        pass


def maintenance_start(state_dir, config):
    atomic_json(state_dir / "launcher.json", config)
    atomic_json(state_dir / "runtime.compose.json", compose_override(config, state_dir, setup_token(state_dir)))
    run(compose_command(state_dir) + ["up", "--detach", "--no-build", "--force-recreate", "--wait", "--wait-timeout", "60", "board"], capture=True)
    if fetch_json(base_url(config) + "/api/health") is None:
        raise LauncherError("Updated workspace did not answer its health check.")


def watch_loop(state_dir: Path, *, once: bool = False) -> int:
    import reliability
    reliability.recover(state_dir,
        lambda: run(compose_command(state_dir) + ["stop", "board"], capture=True),
        lambda config: maintenance_start(state_dir, config))
    maintenance_status = state_dir / "maintenance-status.json"
    if maintenance_status.exists() and read_json(maintenance_status).get("phase") in ("queued", "running"):
        (state_dir / "pending-maintenance.json").unlink(missing_ok=True)
        atomic_json(maintenance_status, {"phase": "interrupted", "message": "Host operation was interrupted; preview again to retry."})
    if not once:
        from codex_buddy import CodexWorker
    worker = CodexWorker(state_dir) if not once else None
    previous_term = signal.getsignal(signal.SIGTERM)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    pid_path = state_dir / ".watcher.pid"
    state_dir.mkdir(parents=True, exist_ok=True)
    pid_path.write_text(f"{os.getpid()}\n", encoding="utf-8")
    request_path = state_dir / "pending-restart.json"
    heartbeat_path = state_dir / ".watcher.heartbeat"
    status_path = state_dir / "restart-status.json"
    try:
        while True:
            heartbeat_path.touch()
            maintenance_path = state_dir / "pending-maintenance.json"
            if maintenance_path.exists():
                try:
                    import reliability
                    request = read_json(maintenance_path)
                    maintenance_path.unlink()
                    config = read_json(state_dir / "launcher.json")
                    if request.get("action") == "apply" and worker:
                        reliability.idle(state_dir)
                        worker.close(); worker = None
                    reliability.process_request(state_dir, config, request,
                        lambda: run(compose_command(state_dir) + ["stop", "board"], capture=True),
                        lambda updated: maintenance_start(state_dir, updated))
                except (Exception, KeyboardInterrupt) as exc:
                    atomic_json(state_dir / "maintenance-status.json", {"requestId": locals().get("request", {}).get("requestId", ""), "phase": "failed", "message": str(exc)[:1000]})
                finally:
                    if not once and worker is None: worker = CodexWorker(state_dir)
                if once: return 0
            if request_path.exists():
                try:
                    request = read_json(request_path)
                    request_path.unlink(missing_ok=True)
                    request_id = request.get("requestId", "")
                    atomic_json(status_path, {"requestId": request_id, "state": "running"})
                    main(["restart", "--state-dir", str(state_dir), "--no-open", "--no-watch"])
                    atomic_json(status_path, {"requestId": request_id, "state": "succeeded"})
                except (LauncherError, OSError) as exc:
                    atomic_json(status_path, {"requestId": locals().get("request_id", ""), "state": "failed", "message": str(exc)})
                if once:
                    return 0
            if once:
                return 0
            time.sleep(1.0)
    finally:
        if worker: worker.close()
        signal.signal(signal.SIGTERM, previous_term)
        heartbeat_path.unlink(missing_ok=True)
        try:
            if pid_path.exists() and pid_path.read_text(encoding="utf-8").strip() == str(os.getpid()):
                pid_path.unlink(missing_ok=True)
        except OSError:
            pass


def main(argv=None) -> int:
    args = parse_args(argv)
    state_dir = args.state_dir.expanduser().absolute()
    if args.command == "watch":
        return watch_loop(state_dir)
    config_path = state_dir / "launcher.json"
    if args.command in ("stop", "status", "logs"):
        if not config_path.exists():
            print("Opportunity Knox has not been started on this host yet.")
            return 0
        config = read_json(config_path)
        ensure_docker(auto_start=False)
        command = compose_command(state_dir)
        if args.command == "stop":
            stop_watcher(state_dir)
            run(command + ["stop", "--timeout", "15"])
            print("Board stopped. Your board and documents are saved.")
        elif args.command == "logs":
            run(command + ["logs", "--tail", "100", "board"])
        else:
            result = run(command + ["ps", "--status", "running", "--quiet", "board"], capture=True)
            print(("Running: " + base_url(config)) if result.stdout.strip() else "Board stopped. Run ./board start to open it.")
        return 0
    ensure_docker()
    state_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(state_dir, 0o700)
    import reliability
    reliability.recover(state_dir,
        lambda: run(compose_command(state_dir) + ["stop", "board"], capture=True),
        lambda saved: maintenance_start(state_dir, saved))
    config, has_pending = make_config(args, state_dir)
    token = setup_token(state_dir)
    override = compose_override(config, state_dir, token)
    runtime_path = state_dir / "runtime.compose.json"
    previous_override = read_json(runtime_path) if runtime_path.exists() else None
    atomic_json(runtime_path, override)
    command = compose_command(state_dir)
    url = base_url(config)
    previous_image = ""
    try:
        # Validate generated Compose before changing a running service.
        run(command + ["config", "--quiet"], capture=True)
        if (state_dir / "board.sqlite").exists():
            import reliability
            reliability.idle(state_dir)
            old_config = read_json(config_path) if config_path.exists() else config
            previous_image = run(command + ["images", "--quiet", "board"], capture=True).stdout.strip()
            if previous_image:
                run(["docker", "tag", previous_image, "opportunity-knox-pre-upgrade:" + str(int(time.time()))], capture=True)
            run(command + ["stop", "board"], capture=True)
            try:
                backup = reliability.snapshot(state_dir, old_config)
                atomic_json(state_dir / "last-upgrade-backup.json", {"name": backup.name, "location": str(backup), "createdAt": time.time()})
                print("Pre-upgrade backup verified.", flush=True)
            except (Exception, KeyboardInterrupt):
                if previous_override is not None: atomic_json(runtime_path, previous_override)
                run(command + ["start", "board"], capture=True, check=False)
                raise
        print("Preparing Opportunity Knox…", flush=True)
        up_args = ["up", "--detach", "--build", "--wait", "--wait-timeout", "60"]
        if args.command == "restart":
            up_args.append("--force-recreate")
        run(command + up_args + ["board"])
        if fetch_json(url + "/api/health") is None:
            raise LauncherError("The container started but the board did not answer. Run ./board logs to inspect it.")
    except (LauncherError, OSError, ValueError, KeyboardInterrupt) as failure:
        # Preserve the last working host settings; pending requests remain available
        # for correction/retry. This does not claim to roll back a running container.
        if previous_override is None:
            runtime_path.unlink(missing_ok=True)
        else:
            atomic_json(runtime_path, previous_override)
            if (state_dir / "board.sqlite").exists():
                if previous_image:
                    run(["docker", "tag", previous_image, PROJECT + "-board:latest"], capture=True, check=False)
                    run(command + ["up", "--detach", "--no-build", "--force-recreate", "--wait", "--wait-timeout", "60", "board"], capture=True, check=False)
                else: run(command + ["start", "board"], capture=True, check=False)
        if isinstance(failure, ValueError): raise LauncherError(str(failure)) from failure
        raise
    atomic_json(config_path, config)
    if has_pending:
        (state_dir / "pending-storage.json").unlink(missing_ok=True)
        (state_dir / "pending-vault.json").unlink(missing_ok=True)
    (state_dir / "pending-restart.json").unlink(missing_ok=True)
    (state_dir / "pending-sources.json").unlink(missing_ok=True)
    if not args.no_watch:
        start_watcher(state_dir)
    session = fetch_json(url + "/api/session")
    launch_url = url + "/"
    if session and session.get("setupRequired"):
        launch_url += "#setup=" + token
    print("Board ready: " + url, flush=True)
    print("Documents: " + config["files"], flush=True)
    if config["bind"] in ("0.0.0.0", "::"):
        print("Other devices: use this host's private network/VPN address with port " + str(config["port"]) + ".", flush=True)
    desktop = sys.platform == "darwin" or bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
    opened = False
    if desktop and not args.no_open:
        opened = webbrowser.open(launch_url)
    if "#setup=" in launch_url and not opened:
        print("First-time password setup (private link): " + launch_url, flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (LauncherError, OSError) as exc:
        print("Opportunity Knox: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
    except KeyboardInterrupt:
        print("\nCancelled. Existing board data is unchanged.", file=sys.stderr)
        raise SystemExit(130)
