#!/usr/bin/env python3
"""Test a built Linux image, including TUN routing and fail-closed behavior."""

import json
import gzip
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import urllib.parse
import uuid

SCRIPT = "/app/packages/web-host/docker/smokeNetwork.py"


def safe_output(text):
    """Keep actionable errors while omitting account and proxy credentials."""
    lines = []
    for line in text.splitlines():
        if re.search(r"password|username|token|secret|cookie|usercode|verificationurl|authorization|bearer", line, re.I):
            lines.append("[redacted sensitive line]")
        else:
            lines.append(re.sub(r"(?<=://)[^\s/@]+:[^\s/@]+@", "[REDACTED]@", line))
    return "\n".join(lines[-40:])


def docker(*args, check=True):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=180)
    if check and result.returncode:
        detail = safe_output(result.stdout + "\n" + result.stderr)
        raise RuntimeError(f"Docker {args[0]} failed (exit {result.returncode})\n{detail}")
    return result


def app_exec(app, *args, check=True, env=None):
    """Match the non-root application's home for browser and CLI probes."""
    flags = ["-e", "HOME=/data/home"]
    for name, value in (env or {}).items():
        flags.extend(["-e", name + "=" + value])
    return docker("exec", "--user", "99:100", *flags, app, *args, check=check)


def inspect(name):
    return json.loads(docker("inspect", name).stdout)[0]


def check(image, revision):
    # Recovery must preserve real Unix owners; the hosted runner is not root.
    recovery = docker("run", "--rm", "--entrypoint", "python3", image, "-m", "unittest", "discover",
                      "-s", "/app/packages/web-host/docker", "-p", "testRelease.py", check=False)
    if recovery.returncode:
        print(recovery.stdout + recovery.stderr)
        raise RuntimeError("Linux release recovery tests failed")
    print("Linux ownership and release recovery tests passed.")
    prefix = "aionui-edu-smoke-" + uuid.uuid4().hex[:10]
    network = prefix + "-net"
    remote_network = prefix + "-remote"
    proxy, target, app = [prefix + suffix for suffix in ("-socks", "-http", "-app")]
    created = []
    networks = []
    volumes = []
    try:
        # Managed runtimes and browser profiles need an ordinary data filesystem.
        # This named volume is disposable and never mounts host application data.
        data_volume = prefix + "-data"
        docker("volume", "create", data_volume)
        volumes.append(data_volume)
        data_mount = "type=volume,src=" + data_volume + ",dst=/data"
        docker("run", "--rm", "--mount", data_mount, "--entrypoint", "chmod", image, "700", "/data")
        for name in [network, remote_network]:
            docker("network", "create", name)
            networks.append(name)
        for name, mode in [(proxy, "socks"), (target, "http")]:
            docker("run", "-d", "--name", name, "--network", network if name == proxy else remote_network, "--entrypoint", "python3", image, SCRIPT, mode)
            created.append(name)
        # A destination on the app's attached subnet is intentionally excluded by
        # sing-tun and rejected by our firewall. Model a remote destination on a
        # separate network, reachable by SOCKS through its second interface.
        docker("network", "connect", remote_network, proxy)
        proxy_ip = inspect(proxy)["NetworkSettings"]["Networks"][network]["IPAddress"]
        proxy_remote_ip = inspect(proxy)["NetworkSettings"]["Networks"][remote_network]["IPAddress"]
        target_ip = inspect(target)["NetworkSettings"]["Networks"][remote_network]["IPAddress"]
        docker("exec", "-d", proxy, "python3", SCRIPT, "http")
        for _ in range(10):
            baseline = docker("exec", proxy, "curl", "--fail", "--silent", "--max-time", "2", f"http://{target_ip}:18080", check=False)
            if baseline.returncode == 0 and json.loads(baseline.stdout)["peer"] == proxy_remote_ip:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Disposable HTTP server was not reachable from SOCKS")
        docker("run", "-d", "--name", app, "--network", network,
               "--cap-add", "NET_ADMIN", "--device", "/dev/net/tun:/dev/net/tun",
               "--security-opt", "no-new-privileges:true", "--security-opt", "seccomp=" + str(Path(__file__).resolve().parent.parent / "src/runtime/browser/security/seccomp.json"),
               "--shm-size", "256m",
               "--mount", data_mount, "-p", "127.0.0.1::25808",
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
        base_url = f"http://127.0.0.1:{port}/"
        with urllib.request.urlopen(base_url, timeout=5) as response:
            html = response.read().decode("utf-8")
        script = re.search(r'<script[^>]+src=["\']([^"\']+\.js)', html)
        if not script:
            raise RuntimeError("Built renderer entry script was not found")
        script_url = urllib.parse.urljoin(base_url, script.group(1))
        with urllib.request.urlopen(urllib.request.Request(script_url, headers={"Accept-Encoding": "identity"}), timeout=5) as response:
            original = response.read()
        with urllib.request.urlopen(urllib.request.Request(script_url, headers={"Accept-Encoding": "gzip"}), timeout=5) as response:
            if response.headers.get("Content-Encoding") != "gzip":
                raise RuntimeError("Renderer entry was not served precompressed")
            if gzip.decompress(response.read()) != original:
                raise RuntimeError("Compressed renderer differs from its final build output")
        print("Precompressed renderer matches final build output.")
        docker("top", app, "-eo", "pid,args")
        runtime_packages = app_exec(
            app, "bun", "-e",
            "const {createRequire}=await import('node:module');"
            "const root=createRequire('/app/package.json');"
            "const host=createRequire('/app/packages/web-host/package.json');"
            "for(const name of ['electron','@sentry/electron','react','@arco-design/web-react','vite','typescript']) {"
            "for(const require of [root,host]) {let found=false;try {require.resolve(name);found=true;}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}"
            "if(found)throw Error('Build-only package in runtime: '+name);}}"
            "for(const name of ['playwright-core','semver','serve-handler','zod','@modelcontextprotocol/sdk/server/mcp.js'])host.resolve(name);"
            "console.log('Production server dependencies only');"
        )
        print(runtime_packages.stdout.strip())
        bubblewrap = app_exec(app, "bwrap", "--version")
        if not bubblewrap.stdout.strip().startswith("bubblewrap "):
            raise RuntimeError("System bubblewrap is not available on the application user's PATH")
        print(bubblewrap.stdout.strip())
        result = app_exec(app, "curl", "--fail", "--silent", "--show-error", "--max-time", "15", f"http://{target_ip}:18080")
        if json.loads(result.stdout)["peer"] != proxy_remote_ip:
            raise RuntimeError("Application TCP traffic bypassed SOCKS5")
        browser_check = app_exec(app, "bun", "-e",
                               "const {createRequire}=await import('node:module'); const {chromium}=createRequire('/app/packages/web-host/package.json')('playwright-core'); const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true,args:['--disable-dev-shm-usage','--disable-quic']}); try {const page=await browser.newPage(); await page.goto('http://" + target_ip + ":18080',{timeout:15000}); const result=JSON.parse(await page.locator('body').innerText()); if(result.peer!=='" + proxy_remote_ip + "') throw Error('browser route bypass'); console.log('Sandboxed Chromium uses SOCKS5'); await page.goto('https://example.com',{timeout:15000,waitUntil:'domcontentloaded'}); if(await page.title()!=='Example Domain') throw Error('browser HTTPS hostname failed'); console.log('Chromium HTTPS hostname uses tunneled DNS');} finally {await browser.close();}")
        print(browser_check.stdout.strip())
        manifest_check = app_exec(
            app, "bun", "-e",
            "const {createRequire}=await import('node:module');"
            "const {chromium}=createRequire('/app/packages/web-host/package.json')('playwright-core');"
            "const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true,args:['--disable-dev-shm-usage']});"
            "try {const context=await browser.newContext();"
            "await context.addCookies([{name:'manifest-session-probe',value:'present',url:'http://127.0.0.1:25808'}]);"
            "const page=await context.newPage();let authenticated=false;"
            "await page.route('**/manifest.webmanifest',async route=>{"
            "const headers=await route.request().allHeaders();authenticated=headers.cookie?.includes('manifest-session-probe=present')??false;"
            "await route.fulfill({status:authenticated?200:401,contentType:'application/manifest+json',body:JSON.stringify({name:'Authenticated manifest',start_url:'/',display:'standalone'})});});"
            "await page.goto('http://127.0.0.1:25808',{waitUntil:'domcontentloaded',timeout:15000});"
            "const session=await context.newCDPSession(page);await session.send('Page.getAppManifest');"
            "if(!authenticated)throw Error('PWA manifest request omitted its session cookie');"
            "console.log('Authenticated PWA manifest includes session credentials');}finally{await browser.close();}"
        )
        print(manifest_check.stdout.strip())
        shared_browser = app_exec(app, "bun", "/app/packages/web-host/src/runtime/browser/smoke.ts",
                                  env={"AIONUI_BUNDLED_CODEX": "/app/node_modules/.bin/codex"})
        print(shared_browser.stdout.strip())
        app_exec(app, "bun", "-e", "await import('node:dns/promises').then(d => d.resolve4('example.com'));", check=True)
        app_exec(app, "bun", "-e", "const {resolve6}=await import('node:dns/promises'); try {const addresses=await resolve6('example.com'); if(addresses.length) throw Error('Tunnel DNS exposed IPv6 answers');} catch(error) {if(!['ENODATA','ENOTFOUND'].includes(error.code)) throw error;}", check=True)
        if '"host": "1.1.1.1"' not in docker("logs", proxy).stdout:
            raise RuntimeError("DNS did not use HTTPS through SOCKS5")
        bypass = app_exec(app, "curl", "--interface", "eth0", "--fail", "--silent", "--max-time", "5", f"http://{target_ip}:18080", check=False)
        if bypass.returncode == 0 and json.loads(bypass.stdout)["peer"] != proxy_remote_ip:
            raise RuntimeError("A tool bound to eth0 bypassed the tunnel")
        local = app_exec(app, "curl", "--fail", "--silent", "--max-time", "5", f"http://{proxy_ip}:18080", check=False)
        if local.returncode == 0:
            raise RuntimeError("An attached-subnet destination bypassed SOCKS5")
        docker("stop", proxy)
        failed = app_exec(app, "curl", "--fail", "--silent", "--max-time", "5", f"http://{target_ip}:18080", check=False)
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
        print(json.dumps({"ok": True, "sourceCommit": revision, "checks": ["health", "TCP via SOCKS5", "DNS via SOCKS5", "bound-interface bypass blocked", "attached-subnet bypass blocked", "proxy outage blocked", "tunnel crash stops app"]}))
    except Exception:
        if app in created:
            for args in [("ip", "rule"), ("ip", "route", "show", "table", "all"), ("iptables", "-w", "-nvL", "AIONUI_EGRESS")]:
                print(docker("exec", app, *args, check=False).stdout)
            print(docker("logs", proxy, check=False).stdout)
            diagnostic = docker("logs", "--tail", "60", app, check=False)
            print(safe_output(diagnostic.stdout + diagnostic.stderr))
        raise
    finally:
        for name in reversed(created):
            docker("rm", "-f", "-v", name, check=False)
        for name in reversed(volumes):
            docker("volume", "rm", name, check=False)
        for name in reversed(networks):
            docker("network", "rm", name, check=False)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: checkContainer.py IMAGE COMMIT")
    check(*sys.argv[1:])
