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
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser

REPO = Path(__file__).resolve().parents[1]
PROJECT = "opportunity-board"


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
    parser.add_argument("command", nargs="?", default="start", choices=["start", "stop", "restart", "status", "logs"])
    parser.add_argument("--files", help="Existing document folder on the hosting machine; remembered for future starts")
    parser.add_argument("--port", type=int, help="Browser port (default: 4318)")
    parser.add_argument("--bind", type=validate_bind, help="Host IP to bind (default: 127.0.0.1)")
    parser.add_argument("--no-open", action="store_true", help="Show the URL without opening a browser")
    parser.add_argument("--state-dir", type=Path, default=Path(os.environ.get("BOARD_STATE_DIR", str(default_state_dir()))), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.port is not None and not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if args.command in ("stop", "status", "logs") and (args.files or args.port is not None or args.bind):
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
    return config, pending_path.exists()


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
    mounts = [{"type": "bind", "source": str(state_dir), "target": "/data", "bind": {"create_host_path": False}}]
    mounts += [{"type": "bind", "source": root, "target": mount_path(root), "read_only": root != config["files"], "bind": {"create_host_path": False}} for root in roots]
    override = {"services": {"board": {
        "ports": [{"target": 4318, "published": str(config["port"]), "host_ip": config["bind"], "protocol": "tcp"}],
        "environment": {"BOARD_DATA_DIR": "/data", "BOARD_FILES_DIR": mount_path(config["files"]), "BOARD_HOST_FILES_DIR": config["files"], "BOARD_DOCUMENT_ROOTS": json.dumps([mount_path(root) for root in roots]), "BOARD_SETUP_TOKEN": token},
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


def main(argv=None) -> int:
    args = parse_args(argv)
    state_dir = args.state_dir.expanduser().absolute()
    config_path = state_dir / "launcher.json"
    if args.command in ("stop", "status", "logs"):
        if not config_path.exists():
            print("Opportunity Knox has not been started on this host yet.")
            return 0
        config = read_json(config_path)
        ensure_docker(auto_start=False)
        command = compose_command(state_dir)
        if args.command == "stop":
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
    config, has_pending = make_config(args, state_dir)
    token = setup_token(state_dir)
    override = compose_override(config, state_dir, token)
    runtime_path = state_dir / "runtime.compose.json"
    previous_override = read_json(runtime_path) if runtime_path.exists() else None
    atomic_json(runtime_path, override)
    command = compose_command(state_dir)
    url = base_url(config)
    try:
        # Validate generated Compose before changing a running service.
        run(command + ["config", "--quiet"], capture=True)
        print("Preparing Opportunity Knox…", flush=True)
        up_args = ["up", "--detach", "--build", "--wait", "--wait-timeout", "60"]
        if args.command == "restart":
            up_args.append("--force-recreate")
        run(command + up_args + ["board"])
        if fetch_json(url + "/api/health") is None:
            raise LauncherError("The container started but the board did not answer. Run ./board logs to inspect it.")
    except (LauncherError, OSError, KeyboardInterrupt):
        # Preserve the last working host settings; pending requests remain available
        # for correction/retry. This does not claim to roll back a running container.
        if previous_override is None:
            runtime_path.unlink(missing_ok=True)
        else:
            atomic_json(runtime_path, previous_override)
        raise
    atomic_json(config_path, config)
    if has_pending:
        (state_dir / "pending-storage.json").unlink(missing_ok=True)
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
