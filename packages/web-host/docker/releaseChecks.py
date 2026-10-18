#!/usr/bin/env python3
"""Pinned release tools and a redacted scan of the exact Git-visible source tree."""

import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
TOOLS = {
    "gitleaks": {
        "version": "8.30.1",
        "repo": "gitleaks/gitleaks",
        "linux": ("linux_x64", "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"),
        "darwin": ("darwin_arm64", "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"),
    },
    "actionlint": {
        "version": "1.7.12",
        "repo": "rhysd/actionlint",
        "linux": ("linux_amd64", "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"),
        "darwin": ("darwin_arm64", "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f"),
    },
}


def tool(name):
    """Download official, checksum-pinned tools outside the checkout."""
    spec = TOOLS[name]
    system = platform.system().lower()
    if (system, platform.machine()) not in {("linux", "x86_64"), ("darwin", "arm64")}:
        raise RuntimeError("Unsupported release-check platform")
    suffix, expected = spec[system]
    cache = Path(tempfile.gettempdir()) / "aionui-edu-release-tools"
    cache.mkdir(mode=0o700, exist_ok=True)
    target = cache / f"{name}-{spec['version']}"
    if target.is_file():
        return str(target)
    url = f"https://github.com/{spec['repo']}/releases/download/v{spec['version']}/{name}_{spec['version']}_{suffix}.tar.gz"
    payload = urllib.request.urlopen(url, timeout=60).read()
    if hashlib.sha256(payload).hexdigest() != expected:
        raise RuntimeError("Release-tool checksum mismatch")
    archive = cache / f"{name}.tar.gz"
    archive.write_bytes(payload)
    try:
        with tarfile.open(archive) as stream:
            member = next(item for item in stream.getmembers() if Path(item.name).name == name)
            target.write_bytes(stream.extractfile(member).read())
        target.chmod(0o700)
    finally:
        archive.unlink(missing_ok=True)
    return str(target)


def scan(history=False):
    """Scan tracked and non-ignored new files; never follow local credential symlinks."""
    names = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT
    ).decode().split("\0")
    with tempfile.TemporaryDirectory(prefix="aionui-edu-source-scan-") as folder:
        snapshot = Path(folder) / "source"
        snapshot.mkdir()
        for name in sorted(set(filter(None, names))):
            source = ROOT / name
            if not source.exists() and not source.is_symlink():
                continue
            target = snapshot / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.is_symlink():
                target.write_text(os.readlink(source))
            else:
                os.link(source, target)
        report = Path(folder) / "redacted.json"
        command = [tool("gitleaks"), "git" if history else "dir", str(ROOT if history else snapshot), "--no-banner", "--redact=100",
                   "--ignore-gitleaks-allow", "--report-format=json", f"--report-path={report}"]
        if history:
            command.append("--log-opts=origin/main..HEAD")
        config = Path(__file__).with_name("gitleaks.toml")
        if config.exists():
            command.extend(["--config", str(config)])
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode:
            findings = json.loads(report.read_text()) if report.exists() else []
            print(json.dumps({"ok": False, "findings": [
                {"file": item["File"] if history else str(Path(item["File"]).relative_to(snapshot)),
                 "line": item["StartLine"], "rule": item["RuleID"]} for item in findings
            ]}, indent=2))
            if not findings:
                print("Secret scanner could not complete; publication is blocked.")
            raise SystemExit(result.returncode)
        print("Outgoing commit secret scan passed." if history else f"Secret scan passed: {len(set(filter(None, names)))} Git-visible paths; no credentials reported.")


if __name__ == "__main__":
    if sys.argv[1:] == ["workflow"]:
        subprocess.run([tool("actionlint"), "-shellcheck=", str(ROOT / ".github/workflows/build-and-release.yml")], check=True)
    elif not sys.argv[1:]:
        scan()
    elif sys.argv[1:] == ["history"]:
        scan(history=True)
    else:
        raise SystemExit("Usage: releaseChecks.py [workflow|history]")
