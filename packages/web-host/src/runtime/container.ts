import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { chown, mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildEgressRules,
  buildTunConfig,
  loadProxySettings,
  resolveSocksProxy,
  proxyFingerprint,
  TUN_DNS,
  TUN_INTERFACE,
} from './proxy.js';

/** This entry point only changes the isolated Linux container's network namespace. */
export async function runContainer(): Promise<void> {
  if (process.platform !== 'linux' || process.env.AIONUI_CONTAINER !== '1' || process.getuid?.() !== 0)
    throw new Error('CONTAINER_ENTRYPOINT_REQUIRES_LINUX_ROOT');
  const dataDir = process.env.AIONUI_DATA_DIR || '/data';
  const userId = Number(process.env.PUID || 99);
  const groupId = Number(process.env.PGID || 100);
  if (!Number.isInteger(userId) || userId < 1 || !Number.isInteger(groupId) || groupId < 1)
    throw new Error('INVALID_CONTAINER_USER');
  const codexHome = process.env.CODEX_HOME || path.join(dataDir, 'codex');
  const homeDir = path.join(dataDir, 'home');
  for (const folder of [dataDir, codexHome, homeDir, path.join(dataDir, 'logs')]) {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await chown(folder, userId, groupId);
  }
  const settings = await loadProxySettings(dataDir);
  let tunnel: ChildProcess | undefined;
  let app: ChildProcess | undefined;
  let stopping = false;
  const stop = (code: number) => {
    if (stopping) return;
    stopping = true;
    if (app?.pid) {
      try {
        process.kill(-app.pid, 'SIGTERM');
      } catch {
        /* Already stopped. */
      }
    }
    // Keep firewall rules installed throughout shutdown. Never fall back to direct egress.
    tunnel?.kill('SIGTERM');
    const forcedExit = setTimeout(() => {
      if (app?.pid) {
        try {
          process.kill(-app.pid, 'SIGKILL');
        } catch {
          /* Already stopped. */
        }
      }
      process.exit(code);
    }, 5000);
    if (!app || app.exitCode !== null || app.signalCode !== null) {
      clearTimeout(forcedExit);
      process.exit(code);
    }
    app.once('exit', () => {
      clearTimeout(forcedExit);
      process.exit(code);
    });
  };
  process.once('SIGTERM', () => stop(0));
  process.once('SIGINT', () => stop(0));
  if (settings.enabled) {
    const proxy = await resolveSocksProxy(settings.proxyUrl);
    await mkdir('/run/aionui', { recursive: true, mode: 0o700 });
    const configPath = '/run/aionui/sing-box.json';
    await writeFile(configPath, JSON.stringify(buildTunConfig(proxy)), { mode: 0o600 });
    execFileSync('sing-box', ['check', '-c', configPath], { stdio: 'pipe' });
    for (const rule of buildEgressRules(proxy)) {
      if (rule.args.includes('-N')) {
        try {
          execFileSync(rule.command, rule.args, { stdio: 'pipe' });
        } catch {
          // A container restart may retain the namespace. Only reuse our own chain.
          execFileSync(rule.command, ['-w', '-S', 'AIONUI_EGRESS'], { stdio: 'pipe' });
          execFileSync(rule.command, ['-w', '-F', 'AIONUI_EGRESS'], { stdio: 'pipe' });
        }
      } else if (rule.args.includes('-I')) {
        try {
          execFileSync(rule.command, ['-w', '-C', 'OUTPUT', '-j', 'AIONUI_EGRESS'], { stdio: 'pipe' });
        } catch {
          execFileSync(rule.command, rule.args, { stdio: 'pipe' });
        }
      } else execFileSync(rule.command, rule.args, { stdio: 'pipe' });
    }
    // Docker's embedded resolver runs outside this namespace; replace it so DNS cannot escape via Docker.
    await writeFile('/etc/resolv.conf', `nameserver ${TUN_DNS}\noptions timeout:2 attempts:2\n`);
    tunnel = spawn('sing-box', ['run', '-c', configPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    tunnel.stderr?.resume();
    tunnel.once('error', () => stop(1));
    tunnel.once('exit', () => {
      if (!stopping) stop(1);
    });
    let ready = false;
    for (let attempt = 0; attempt < 100 && !stopping; attempt += 1) {
      try {
        execFileSync('ip', ['link', 'show', TUN_INTERFACE], { stdio: 'pipe' });
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    if (!ready || stopping) throw new Error('SOCKS5_TUNNEL_START_FAILED');
    console.log('[network] SOCKS5 full routing enabled; direct external egress is blocked.');
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    HOME: homeDir,
    AIONUI_DATA_DIR: dataDir,
    AIONUI_ACTIVE_PROXY_HASH: proxyFingerprint(settings),
  };
  // The application and all its tools run without network-administration capabilities.
  app = spawn(
    'setpriv',
    [
      '--reuid',
      String(userId),
      '--regid',
      String(groupId),
      '--clear-groups',
      '--bounding-set=-all',
      '--inh-caps=-all',
      '--no-new-privs',
      'bun',
      path.join(repoRoot, 'scripts/webui.ts'),
      '--no-build',
      '--no-open',
      '--remote',
    ],
    { cwd: repoRoot, env, detached: true, stdio: 'inherit' }
  );
  app.once('error', () => stop(1));
  app.once('exit', (code) => stop(code ?? 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runContainer().catch(() => {
    console.error(
      '[network] Container startup failed; the application was not started. Check proxy settings, NET_ADMIN and /dev/net/tun.'
    );
    process.exit(1);
  });
}
