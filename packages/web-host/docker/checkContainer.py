#!/usr/bin/env python3
"""Test a built Linux image, including TUN routing and fail-closed behavior."""

import json
import re
import subprocess
import sys
import time
import urllib.request
import uuid

SCRIPT = "/app/packages/web-host/docker/smokeNetwork.py"


def docker(*args, check=True):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=180)
    if check and result.returncode:
        raise RuntimeError(f"Docker {args[0]} failed (exit {result.returncode})")
    return result


def inspect(name):
    return json.loads(docker("inspect", name).stdout)[0]


def check(image, revision):
    prefix = "aionui-edu-smoke-" + uuid.uuid4().hex[:10]
    network = prefix + "-net"
    proxy, target, app = [prefix + suffix for suffix in ("-socks", "-http", "-app")]
    created = []
    docker("network", "create", network)
    try:
        for name, mode in [(proxy, "socks"), (target, "http")]:
            docker("run", "-d", "--name", name, "--network", network, "--entrypoint", "python3", image, SCRIPT, mode)
            created.append(name)
        proxy_ip = inspect(proxy)["NetworkSettings"]["Networks"][network]["IPAddress"]
        target_ip = inspect(target)["NetworkSettings"]["Networks"][network]["IPAddress"]
        docker("run", "-d", "--name", app, "--network", network,
               "--cap-add", "NET_ADMIN", "--device", "/dev/net/tun:/dev/net/tun",
               "--tmpfs", "/data:rw,size=256m,mode=0700", "-p", "127.0.0.1::25808",
               "-e", "AIONUI_SOCKS5_PROXY=socks5://" + proxy_ip + ":1080", image)
        created.append(app)
        port = inspect(app)["NetworkSettings"]["Ports"]["25808/tcp"][0]["HostPort"]
        for _ in range(90):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=3) as response:
                    health = json.load(response)
                if health.get("ok") and health.get("sourceCommit") == revision:
                    break
            except (OSError, ValueError):
                pass
            if not inspect(app)["State"]["Running"]:
                raise RuntimeError("Image stopped during TUN startup")
            time.sleep(1)
        else:
            raise RuntimeError("WebUI did not become healthy")
        result = docker("exec", "--user", "99:100", app, "curl", "--fail", "--silent", "--show-error", "--max-time", "15", f"http://{target_ip}:18080")
        if json.loads(result.stdout)["peer"] != proxy_ip:
            raise RuntimeError("Application TCP traffic bypassed SOCKS5")
        docker("exec", "--user", "99:100", app, "bun", "-e", "await import('node:dns/promises').then(d => d.resolve4('example.com'));", check=True)
        if '"host": "1.1.1.1"' not in docker("logs", proxy).stdout:
            raise RuntimeError("DNS did not use HTTPS through SOCKS5")
        bypass = docker("exec", "--user", "99:100", app, "curl", "--interface", "eth0", "--fail", "--silent", "--max-time", "5", f"http://{target_ip}:18080", check=False)
        if bypass.returncode == 0 and json.loads(bypass.stdout)["peer"] != proxy_ip:
            raise RuntimeError("A tool bound to eth0 bypassed the tunnel")
        docker("stop", proxy)
        failed = docker("exec", "--user", "99:100", app, "curl", "--fail", "--silent", "--max-time", "5", f"http://{target_ip}:18080", check=False)
        if failed.returncode == 0:
            raise RuntimeError("Proxy outage fell back to direct egress")
        # Locate the supervisor child without adding procps to the runtime image.
        docker("exec", app, "python3", "-c", "import os,pathlib,signal; [os.kill(int(p.name),signal.SIGTERM) for p in pathlib.Path('/proc').iterdir() if p.name.isdigit() and (p/'comm').exists() and (p/'comm').read_text().strip()=='sing-box']", check=False)
        for _ in range(12):
            if not inspect(app)["State"]["Running"]:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Tunnel exit did not stop the application")
        print(json.dumps({"ok": True, "sourceCommit": revision, "checks": ["health", "TCP via SOCKS5", "DNS via SOCKS5", "bound-interface bypass blocked", "proxy outage blocked", "tunnel crash stops app"]}))
    except Exception:
        if app in created:
            for args in [("ip", "rule"), ("ip", "route", "show", "table", "all"), ("iptables", "-w", "-nvL", "AIONUI_EGRESS")]:
                print(docker("exec", app, *args, check=False).stdout)
            print(docker("logs", proxy, check=False).stdout)
            diagnostic = docker("logs", "--tail", "60", app, check=False)
            for line in (diagnostic.stdout + diagnostic.stderr).splitlines():
                if not re.search(r"password|username|token|secret|cookie|usercode|verificationurl", line, re.I):
                    print(line)
        raise
    finally:
        for name in reversed(created):
            docker("rm", "-f", "-v", name, check=False)
        docker("network", "rm", network, check=False)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: checkContainer.py IMAGE COMMIT")
    check(*sys.argv[1:])
