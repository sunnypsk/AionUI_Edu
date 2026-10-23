#!/usr/bin/env python3
"""Locally installed, project-scoped GHCR updater with isolated probes and rollback."""

import fcntl
import getpass
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET

BASE = Path("/mnt/user/appdata/aionui-edu")
NAME = "aionui-edu"
IMAGE = "ghcr.io/sunnypsk/aionui_edu"
CODE = Path("/boot/config/plugins/aionui-edu-autodeploy")
CRON = Path("/boot/config/plugins/dynamix/aionui-edu-autodeploy.cron")
TEMPLATE = Path("/boot/config/plugins/dockerMan/templates-user/my-aionui-edu.xml")
BROWSER_SECCOMP_SHA = "09293f2779f2611a01c58c56ee4a46f12e32c2cf3c96ccb055574f0dc13acabf"


def browser_seccomp_source():
    """Only a reviewed, pinned policy can grant Chromium its user namespaces."""
    parent = Path(__file__).resolve().parent
    for source in (parent / "browser" / "seccomp.json", parent.parent / "src/runtime/browser/security/seccomp.json"):
        if source.is_file():
            value = json.loads(source.read_text())
            digest = hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            if digest == BROWSER_SECCOMP_SHA:
                return source, value
    raise ValueError("Copy the reviewed browser/seccomp.json alongside deployUnraid.py before installation")


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w") as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def copy_data(source, target):
    """Keep private application files readable by their original owners after rollback."""
    shutil.copytree(source, target, symlinks=True)
    for current, folders, files in os.walk(source, followlinks=False):
        for name in [None, *folders, *files]:
            original = Path(current) if name is None else Path(current) / name
            copied = target / original.relative_to(source)
            owner, actual = original.lstat(), copied.lstat()
            if (actual.st_uid, actual.st_gid) != (owner.st_uid, owner.st_gid):
                os.chown(copied, owner.st_uid, owner.st_gid, follow_symlinks=False)


def docker(*args):
    # First-time browser image downloads can take longer than container operations.
    timeout = 1800 if args and args[0] == "pull" else 300
    result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        # Docker diagnostics can include environment values. Keep them off the console.
        raise RuntimeError("Docker operation failed: " + args[0])
    return result.stdout.strip()


def inventory():
    ids = docker("ps", "-aq").splitlines()
    return {item["Name"].lstrip("/"): item for item in json.loads(docker("inspect", *ids))} if ids else {}


def browser_profile_in_use(profiles, proc=Path("/proc")):
    """Check host Chromium launch arguments as well as the container mount guard."""
    root = profiles.resolve()
    for process in proc.iterdir():
        if not process.name.isdigit():
            continue
        try:
            args = [os.fsdecode(part) for part in (process / "cmdline").read_bytes().split(b"\0") if part]
            for index, argument in enumerate(args):
                value = argument[len("--user-data-dir="):] if argument.startswith("--user-data-dir=") else (
                    args[index + 1] if argument == "--user-data-dir" and index + 1 < len(args) else None)
                if not value:
                    continue
                profile = Path(value)
                if not profile.is_absolute():
                    profile = (process / "cwd").resolve() / profile
                profile = profile.resolve()
                if profile == root or root in profile.parents:
                    return True
        except (FileNotFoundError, ProcessLookupError):
            continue  # The process exited while being inspected.
        except OSError:
            raise RuntimeError("Cannot verify browser profile process ownership") from None
    return False


def fingerprint(item):
    return item["Id"], item["Image"], item["State"]["Running"]


def validate_image(info):
    labels = info.get("Config", {}).get("Labels", {}) or {}
    revision = labels.get("org.opencontainers.image.revision", "")
    sequence = labels.get("uk.littlething.aionui-edu.release-sequence", "")
    if (info.get("Os") != "linux" or info.get("Architecture") != "amd64" or
            labels.get("org.opencontainers.image.source") != "https://github.com/sunnypsk/AionUI_Edu" or
            not re.fullmatch(r"[0-9a-f]{40}", revision) or not re.fullmatch(r"[1-9][0-9]*\.[1-9][0-9]*", sequence)):
        raise ValueError("Image identity or release sequence is invalid")
    digest = next((item for item in info.get("RepoDigests", []) if re.fullmatch(re.escape(IMAGE) + r"@sha256:[0-9a-f]{64}", item)), None)
    if not digest:
        raise ValueError("Expected a pinned GHCR digest")
    return {"sourceCommit": revision, "sequence": list(map(int, sequence.split("."))), "imageId": info["Id"], "image": digest}


DEFAULT_PIDS_LIMIT = 1024


class Deployment:
    def __init__(self, base=BASE, template=TEMPLATE):
        self.base = base
        self.control = base / "deployment"
        self.data = base / "data"
        self.template = template
        self.settings = read(self.control / "settings.json", {})

    def validate_settings(self):
        required = {"bindAddress", "port", "puid", "pgid"}
        if not required <= set(self.settings) <= required | {"pidsLimit"}:
            raise ValueError("Write the reviewed NAS settings.json first")
        address = ipaddress.ip_address(self.settings["bindAddress"])
        if address.version != 4 or address.is_unspecified or address.is_multicast:
            raise ValueError("Bind to an explicit NAS IPv4 address")
        for key in ("port", "puid", "pgid"):
            value = self.settings[key]
            if type(value) is not int or not 1 <= value <= (65535 if key == "port" else 2**31 - 1):
                raise ValueError("Invalid deployment setting")
        pids_limit = self.settings.get("pidsLimit", DEFAULT_PIDS_LIMIT)
        if type(pids_limit) is not int or not 512 <= pids_limit <= 1024:
            raise ValueError("pidsLimit must be an integer between 512 and 1024")
        if self.base.is_symlink() or self.data.is_symlink() or self.control.is_symlink():
            raise ValueError("Deployment directories must not be symlinks")
        proxy = read(self.data / "network-proxy.json", {})
        if proxy.get("enabled") is not True:
            raise ValueError("Configure SOCKS5 before first startup")
        try:
            url = urllib.parse.urlsplit(proxy["proxyUrl"])
            ipaddress.ip_address(url.hostname)
            if url.scheme not in {"socks5", "socks5h"} or not url.port or url.query or url.fragment or url.path not in {"", "/"}:
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise ValueError("Invalid private SOCKS5 configuration") from None
        proxy_file = self.data / "network-proxy.json"
        if proxy_file.stat().st_mode & 0o077:
            raise ValueError("SOCKS5 configuration must be owner-only")

    def create_args(self, image, name=NAME, probe_data=None):
        _, policy = browser_seccomp_source()
        policy_file = self.control / "browser-seccomp.json"
        atomic(policy_file, policy)
        probe = probe_data is not None
        port = "127.0.0.1::25808" if probe else f"{self.settings['bindAddress']}:{self.settings['port']}:25808"
        return ["run", "-d", "--name", name, "--network", "bridge",
                "--restart", "no" if probe else "unless-stopped",
                "--cap-add", "NET_ADMIN", "--device", "/dev/net/tun:/dev/net/tun",
                "--security-opt", "no-new-privileges:true", "--pids-limit", str(self.settings.get("pidsLimit", DEFAULT_PIDS_LIMIT)),
                "--security-opt", f"seccomp={policy_file}", "--shm-size", "256m",
                "--log-opt", "max-size=10m", "--log-opt", "max-file=3", "-p", port,
                "-v", f"{probe_data or self.data}:/data:rw",
                "-e", f"PUID={self.settings['puid']}", "-e", f"PGID={self.settings['pgid']}",
                "--label", "uk.littlething.aionui-edu.managed=1",
                "--label", "net.unraid.docker.managed=dockerman",
                "--label", f"net.unraid.docker.webui=http://{self.settings['bindAddress']}:{self.settings['port']}", image]

    def healthy(self, name, release):
        for _ in range(90):
            item = json.loads(docker("inspect", name))[0]
            if not item["State"]["Running"]:
                raise RuntimeError("New application stopped before becoming healthy")
            port = item["NetworkSettings"]["Ports"]["25808/tcp"][0]["HostPort"]
            address = "127.0.0.1" if name != NAME else self.settings["bindAddress"]
            try:
                with urllib.request.urlopen(f"http://{address}:{port}/healthz", timeout=4) as response:
                    status = json.load(response)
                if (status.get("ok") is True and status.get("app") == "aionui-edu" and
                        status.get("sourceCommit") == release["sourceCommit"] and
                        status.get("releaseSequence") == ".".join(map(str, release["sequence"]))):
                    return
            except (OSError, ValueError):
                pass
            time.sleep(1)
        raise RuntimeError("New application did not pass health/version verification")

    def probe(self, release):
        name = NAME + "-probe-" + uuid.uuid4().hex[:10]
        folder = self.control / name
        folder.mkdir(mode=0o700)
        # Candidates get only proxy configuration, never chats, OAuth credentials or live files.
        shutil.copy2(self.data / "network-proxy.json", folder / "network-proxy.json")
        os.chown(folder / "network-proxy.json", self.settings["puid"], self.settings["pgid"])
        container_id = None
        try:
            container_id = docker(*self.create_args(release["image"], name, folder))
            self.healthy(name, release)
            docker("exec", "--user", f"{self.settings['puid']}:{self.settings['pgid']}", container_id,
                   "curl", "--fail", "--silent", "--max-time", "20", "https://example.com")
        finally:
            if container_id:
                docker("rm", "-f", "-v", container_id)
            shutil.rmtree(folder)

    def validate_existing(self, old):
        host = old["HostConfig"]
        mounts = {(item.get("Type"), item.get("Source"), item.get("Destination")) for item in old.get("Mounts", [])}
        expected_port = {"25808/tcp": [{"HostIp": self.settings["bindAddress"], "HostPort": str(self.settings["port"])}]}
        if (old["Config"].get("Labels", {}).get("uk.littlething.aionui-edu.managed") != "1" or
                mounts != {("bind", str(self.data), "/data")} or host.get("Privileged") or
                host.get("NetworkMode") != "bridge" or host.get("PortBindings") != expected_port):
            raise ValueError("Existing container differs from this reviewed deployment")
        # A live conversation keeps its CLI process. Be conservative and defer the update.
        processes = docker("top", old["Id"], "-eo", "pid,args").splitlines()[1:]
        for command in processes:
            if re.search(r"(?:^|[/\s])(?:codex|codex-acp)(?:\s|$)", command) and "cli_auth_credentials_store=" not in command:
                raise RuntimeError("Codex is still running; update deferred")
            if re.search(r"(?:^|[/\s])(?:chromium|chrome)(?:\s|$)", command) and "browser-profiles" in command:
                raise RuntimeError("Shared browser is still running; update deferred")

    def write_template(self, release):
        tree = ET.Element("Container", version="2")
        values = {"Name": NAME, "Repository": release["image"], "Network": "bridge", "Shell": "bash",
                  "Privileged": "false", "Project": "https://github.com/sunnypsk/AionUI_Edu",
                  "WebUI": f"http://{self.settings['bindAddress']}:{self.settings['port']}",
                  "ExtraParams": f"--cap-add=NET_ADMIN --security-opt=no-new-privileges --security-opt=seccomp={self.control / 'browser-seccomp.json'} --shm-size=256m --pids-limit={self.settings.get('pidsLimit', DEFAULT_PIDS_LIMIT)} --restart=unless-stopped --publish={self.settings['bindAddress']}:{self.settings['port']}:25808 --log-opt=max-size=10m --log-opt=max-file=3"}
        for key, value in values.items():
            ET.SubElement(tree, key).text = value
        for label, target, kind, mode, value in [
            ("Application data", "/data", "Path", "rw", str(self.data)),
            ("TUN device", "/dev/net/tun", "Device", "", "/dev/net/tun"),
            ("PUID", "PUID", "Variable", "", str(self.settings["puid"])),
            ("PGID", "PGID", "Variable", "", str(self.settings["pgid"])),
        ]:
            ET.SubElement(tree, "Config", Name=label, Target=target, Type=kind, Mode=mode, Display="always", Required="true", Mask="false").text = value
        self.template.parent.mkdir(parents=True, exist_ok=True)
        self.template.write_text(ET.tostring(tree, encoding="unicode"))
        self.template.chmod(0o600)

    def release_browser_locks(self, backup):
        """Release only backed-up Chromium symlinks after every owner of this data mount has stopped."""
        profiles = self.data / "browser-profiles"
        if profiles.is_symlink():
            raise RuntimeError("Browser profile root must not be a symlink")
        if not profiles.exists():
            return
        locks = []
        for profile in profiles.iterdir():
            if not re.fullmatch(r"[0-9a-f]{64}", profile.name):
                continue
            if profile.is_symlink() or not profile.is_dir():
                raise RuntimeError("Browser profile must be an owned directory")
            owner = profile.lstat()
            if (owner.st_uid, owner.st_gid) != (self.settings["puid"], self.settings["pgid"]):
                raise RuntimeError("Browser profile ownership differs from the application user")
            for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
                lock = profile / name
                if lock.is_symlink():
                    archived = backup / "data" / lock.relative_to(self.data)
                    if not archived.is_symlink() or archived.readlink() != lock.readlink():
                        raise RuntimeError("Browser lock snapshot is missing or changed")
                    locks.append(lock)
                elif lock.exists():
                    raise RuntimeError("Unrecognized browser lock; leaving it untouched")
        if not locks:
            return
        data = self.data.resolve()
        for container in inventory().values():
            if not container.get("State", {}).get("Running"):
                continue
            for mount in container.get("Mounts", []):
                source = Path(mount.get("Source", "/")).resolve()
                if source == data or source in data.parents or data in source.parents:
                    raise RuntimeError("Browser data is still mounted by a running container")
        if browser_profile_in_use(profiles):
            raise RuntimeError("Browser profile is still used by a host process")
        for lock in locks:
            lock.unlink()
        print(json.dumps({"event": "browser.staleLocksReleased", "count": len(locks)}))

    def restore(self, journal):
        current = inventory().get(NAME)
        old_id = journal.get("oldId")
        if current and current["Id"] != old_id:
            if current["Image"] != journal["imageId"] or current["Config"].get("Labels", {}).get("uk.littlething.aionui-edu.managed") != "1":
                raise RuntimeError("Unexpected container occupies the application name")
            docker("rm", "-f", "-v", current["Id"])
        if journal.get("snapshotComplete"):
            failed = Path(journal["backup"]) / "failed-data"
            if self.data.exists():
                if failed.exists():
                    raise RuntimeError("Interrupted data restore requires manual review")
                self.data.rename(failed)
            copy_data(Path(journal["backup"]) / "data", self.data)
            self.release_browser_locks(Path(journal["backup"]))
        if old_id:
            old = json.loads(docker("inspect", old_id))[0]
            if old["Name"] != "/" + NAME:
                docker("rename", old_id, NAME)
            docker("update", "--restart=unless-stopped", old_id)
            docker("start", old_id)
        if journal.get("template") is not None:
            self.template.write_text(journal["template"])
        elif self.template.exists():
            self.template.unlink()
        atomic(self.control / "failed.json", {"imageId": journal["imageId"], "reason": "Release failed; previous container and data restored"})
        (self.control / "journal.json").unlink(missing_ok=True)

    def apply(self, install=False):
        self.validate_settings()
        before = inventory()
        old = before.get(NAME)
        if install and (old or self.template.exists()):
            raise ValueError("Application already exists; first installation refused")
        if not install and not old:
            raise ValueError("Application is not installed")
        if old and not old["State"]["Running"]:
            print("Application is stopped; leaving it stopped.")
            return
        if old:
            self.validate_existing(old)
        else:
            with socket.socket() as connection:
                connection.bind((self.settings["bindAddress"], self.settings["port"]))
        docker("pull", IMAGE + ":stable")
        release = validate_image(json.loads(docker("image", "inspect", IMAGE + ":stable"))[0])
        previous = read(self.control / "current.json", {})
        if old and old["Image"] == release["imageId"]:
            return
        if previous and release["sequence"] <= previous["sequence"]:
            raise ValueError("Refusing an older release; publish a new revert commit")
        if read(self.control / "failed.json", {}).get("imageId") == release["imageId"]:
            raise ValueError("Previously failed release is held for review")
        self.probe(release)
        # Recheck after the probe; do not interrupt a newly started Codex session.
        if old:
            self.validate_existing(json.loads(docker("inspect", old["Id"]))[0])
        backup = self.base / "backups" / (release["sourceCommit"][:12] + "-" + uuid.uuid4().hex[:8])
        backup.mkdir(parents=True, mode=0o700)
        journal = {"oldId": old["Id"] if old else None, "imageId": release["imageId"], "backup": str(backup),
                   "template": self.template.read_text() if self.template.exists() else None, "snapshotComplete": False}
        atomic(self.control / "journal.json", journal)
        try:
            if old:
                docker("stop", "--time", "20", old["Id"])
            copy_data(self.data, backup / "data")
            journal["snapshotComplete"] = True
            atomic(self.control / "journal.json", journal)
            self.release_browser_locks(backup)
            if old:
                docker("rename", old["Id"], NAME + "-rollback-" + backup.name)
                docker("update", "--restart=no", old["Id"])
            new_id = docker(*self.create_args(release["image"]))
            self.healthy(NAME, release)
            after = inventory()
            if any(name not in after or fingerprint(item) != fingerprint(after[name]) for name, item in before.items() if name != NAME):
                raise RuntimeError("Another service changed during deployment; verification requires review")
            self.write_template(release)
            atomic(self.control / "current.json", {**release, "containerId": new_id, "backup": str(backup), "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
            (self.control / "journal.json").unlink()
            print(json.dumps({"ok": True, "sourceCommit": release["sourceCommit"], "image": release["image"], "url": f"http://{self.settings['bindAddress']}:{self.settings['port']}"}))
        except BaseException:
            self.restore(journal)
            raise


def install_updater():
    if CODE.exists() or CRON.exists():
        raise ValueError("Updater already installed; refusing to replace local deployment code")
    CODE.mkdir(parents=True)
    target = CODE / "deployUnraid.py"
    shutil.copy2(__file__, target)
    target.chmod(0o700)
    source, _ = browser_seccomp_source()
    (CODE / "browser").mkdir()
    shutil.copy2(source, CODE / "browser" / "seccomp.json")
    (BASE / "deployment" / "PAUSED").touch(mode=0o600)
    CRON.write_text("# AionUI_Edu: opt-in, project-scoped GHCR updater\n*/5 * * * * test -S /var/run/docker.sock && /usr/bin/python3 /boot/config/plugins/aionui-edu-autodeploy/deployUnraid.py 2>&1 | /usr/bin/logger -t aionui-edu-autodeploy\n")
    subprocess.run(["/bin/bash", "/usr/local/sbin/update_cron"], check=True)
    print("Updater installed paused. Review an idle maintenance window before enabling automatic updates.")


def configure_proxy(endpoint):
    """Prompt on the NAS itself; credentials never enter shell arguments or GitHub."""
    url = urllib.parse.urlsplit("socks5://" + endpoint)
    if not url.hostname or not url.port or url.username or url.password or url.path or url.query or url.fragment:
        raise ValueError("Provide only the SOCKS5 hostname/IP and port")
    settings = read(BASE / "deployment" / "settings.json", {})
    if not all(type(settings.get(key)) is int and settings[key] > 0 for key in ("puid", "pgid")):
        raise ValueError("Prepare the NAS settings.json before configuring credentials")
    address = socket.getaddrinfo(url.hostname, url.port, family=socket.AF_INET, type=socket.SOCK_STREAM)[0][4][0]
    username = getpass.getpass("SOCKS5 service username (hidden): ").encode()
    password = getpass.getpass("SOCKS5 service password (hidden): ").encode()
    if not 1 <= len(username) <= 255 or not 1 <= len(password) <= 255:
        raise ValueError("SOCKS5 username/password must be 1-255 UTF-8 bytes")
    with socket.create_connection((address, url.port), timeout=10) as connection:
        def reply():
            result = b""
            while len(result) < 2:
                part = connection.recv(2 - len(result))
                if not part:
                    raise RuntimeError("SOCKS5 authentication connection closed")
                result += part
            return result
        connection.sendall(bytes([5, 1, 2]))
        if reply() != bytes([5, 2]):
            raise RuntimeError("SOCKS5 authentication method was not accepted")
        connection.sendall(bytes([1, len(username)]) + username + bytes([len(password)]) + password)
        if reply() != bytes([1, 0]):
            raise RuntimeError("SOCKS5 authentication failed; nothing was saved")
    data = BASE / "data"
    if data.is_symlink():
        raise ValueError("Data directory must not be a symlink")
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    proxy = f"socks5://{urllib.parse.quote(username.decode(), safe='')}:{urllib.parse.quote(password.decode(), safe='')}@{address}:{url.port}"
    atomic(data / "network-proxy.json", {"enabled": True, "proxyUrl": proxy})
    for path in (data, data / "network-proxy.json"):
        os.chown(path, settings["puid"], settings["pgid"])
    print("SOCKS5 authentication verified; configuration saved privately on the NAS.")


def main():
    if sys.platform != "linux" or os.geteuid() != 0 or not Path("/var/run/docker.sock").is_socket():
        raise RuntimeError("Run this reviewed script on the Unraid host")
    os.umask(0o077)
    deployment = Deployment()
    deployment.control.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (deployment.control / "update.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        journal = read(deployment.control / "journal.json")
        if journal:
            deployment.restore(journal)
        args = sys.argv[1:]
        if len(args) == 2 and args[0] == "--configure-proxy":
            configure_proxy(args[1])
        elif args == ["--install"]:
            deployment.apply(install=True)
            install_updater()
        elif args == ["--apply"]:
            deployment.apply()
        elif args:
            raise ValueError("Usage: deployUnraid.py [--configure-proxy HOST:PORT|--install|--apply]")
        elif not (deployment.control / "PAUSED").exists():
            deployment.apply()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
