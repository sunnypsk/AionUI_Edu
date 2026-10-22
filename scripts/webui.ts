#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebUI backend, static server and authentication (Bun development, bundled Node production).
 *
 * Env vars:
 *   AIONUI_PORT           : static server port (default 25809 dev / 25808 production)
 *   AIONUI_HOST           : listen host; set to 0.0.0.0 to imply --remote
 *   AIONUI_ALLOW_REMOTE   : "1"/"true" to expose to LAN
 *   AIONUI_DATA_DIR       : override the WebUI data directory
 *   AIONUI_LOG_DIR        : override log dir (default <dataDir>/logs)
 *   AIONUI_STATIC_DIR     : override static dir (default out/renderer)
 *   AIONUI_BACKEND_BIN    : explicit Core override (default: verified OpenUI Core build)
 *   AIONUI_BACKEND_BUNDLED_DIR : dir containing bundled-aioncore/<plat-arch>/binary
 *   AIONUI_OPEN_BROWSER   : "1"/"true" to force open, "0"/"false" to disable
 */

import { execSync } from 'child_process';
import { resolveOpenUiCore } from '../packages/web-host/openui/core/resolve';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { startWebHost, readWebUiAdminUsername, resetWebUiPassword } from '@aionui/web-host';
import { openBrowserUrl, shouldAutoOpenBrowser } from '../packages/web-host/src/browser.js';

// Aligned with packages/desktop/src/common/config/constants.ts WEBUI_DEFAULT_PORT.
const DEFAULT_PORT = (() => {
  if (process.env.NODE_ENV === 'production') return 25808;
  if (process.env.AIONUI_MULTI_INSTANCE === '1') return 25810;
  return 25809;
})();
const BACKEND_BINARY = process.platform === 'win32' ? 'aioncore.exe' : 'aioncore';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = process.env.AIONUI_APP_ROOT
  ? path.resolve(process.env.AIONUI_APP_ROOT)
  : path.resolve(path.dirname(__filename), '..');

const args = process.argv.slice(2);
const has = (name: string): boolean => args.includes(name);
const getFlag = (name: string): string | undefined => {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : undefined;
};

/**
 * Resolve the existing WebUI data directory without migrating or renaming it.
 * CLI --data-dir takes precedence over AIONUI_DATA_DIR, then ~/.aionui-web
 * (production), ~/.aionui-web-dev or ~/.aionui-web-dev-2 (development).
 */
function resolveBackendDataDir(): string {
  const override = getFlag('--data-dir') ?? process.env.AIONUI_DATA_DIR;
  if (override && override.trim().length > 0) {
    const resolved = path.resolve(override);
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  }
  const suffix =
    process.env.NODE_ENV === 'production' ? '' : process.env.AIONUI_MULTI_INSTANCE === '1' ? '-dev-2' : '-dev';
  const dir = path.join(os.homedir(), `.aionui-web${suffix}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function parseBoolean(v: string | undefined): boolean {
  if (!v) return false;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function resolvePort(): number {
  const cli = getFlag('--port');
  if (cli && /^\d+$/.test(cli)) return Number(cli);
  const env = process.env.AIONUI_PORT ?? process.env.PORT;
  if (env && /^\d+$/.test(env)) return Number(env);
  return DEFAULT_PORT;
}

function resolveAllowRemote(): boolean {
  if (has('--remote')) return true;
  const host = process.env.AIONUI_HOST?.trim();
  if (host && ['0.0.0.0', '::', '::0'].includes(host)) return true;
  return parseBoolean(process.env.AIONUI_ALLOW_REMOTE ?? process.env.AIONUI_REMOTE);
}

function resolveStaticDir(): string {
  if (process.env.AIONUI_STATIC_DIR) return process.env.AIONUI_STATIC_DIR;
  const candidate = path.join(repoRoot, 'out', 'renderer');
  if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  throw new Error(`Renderer assets not found at ${candidate}. Run "bun run package" first, or set AIONUI_STATIC_DIR.`);
}

/**
 * Rebuild the SPA and Codex runtime before launching, so that `bun run webui` always
 * serves the latest source. Skipped when:
 *   --no-build flag           : explicit opt-out (e.g., iterating on this script)
 *   $AIONUI_NO_BUILD=1        : env-level opt-out
 *   $AIONUI_STATIC_DIR is set : caller is pointing us at a prebuilt artifact dir
 */
function runPackageIfNeeded(): void {
  if (process.env.AIONUI_CONTAINER === '1') return;
  if (has('--no-build')) return;
  if (parseBoolean(process.env.AIONUI_NO_BUILD)) return;
  if (process.env.AIONUI_STATIC_DIR) return;
  console.log('[webui] running "bun run package" to refresh out/renderer (pass --no-build to skip)...');
  const start = Date.now();
  execSync('bun run package', { cwd: repoRoot, stdio: 'inherit' });
  console.log(`[webui] package finished in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

function resolveBackendBinary(): string {
  return resolveOpenUiCore(repoRoot);
}

/**
 * Discover CLI tools installed under nvm-managed Node versions before starting
 * the backend. Missing command paths otherwise cause agent handshake failures.
 */
function augmentPathWithNvm(): void {
  if (process.platform === 'win32') return;
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
  const versionsDir = path.join(nvmDir, 'versions', 'node');
  if (!fs.existsSync(versionsDir)) return;
  try {
    const versions = fs.readdirSync(versionsDir);
    const nvmBins = versions.map((v) => path.join(versionsDir, v, 'bin')).filter((p) => fs.existsSync(p));
    if (nvmBins.length === 0) return;
    const current = process.env.PATH || '';
    const missing = nvmBins.filter((p) => !current.split(path.delimiter).includes(p));
    if (missing.length > 0) {
      process.env.PATH = [...missing, current].join(path.delimiter);
    }
  } catch {
    // best-effort
  }
}

async function main(): Promise<void> {
  augmentPathWithNvm();
  // Prefer this fork's pinned Codex CLI over a different global installation.
  process.env.PATH = [path.join(repoRoot, 'node_modules', '.bin'), process.env.PATH || ''].join(path.delimiter);
  runPackageIfNeeded();
  const port = resolvePort();
  const allowRemote = resolveAllowRemote();
  const autoOpenBrowser = shouldAutoOpenBrowser({
    allowRemote,
    env: process.env,
    openFlag: has('--open'),
    noOpenFlag: has('--no-open'),
  });
  // One working dir for the whole standalone webui: backend SQLite and chat
  // history live here. Admin credentials live in the backend's users table.
  const workDir = resolveBackendDataDir();
  if (process.platform !== 'win32') {
    const codexBundle = path.join(repoRoot, 'dist-server', 'codex', 'launcher.mjs');
    if (!fs.existsSync(codexBundle)) {
      if (process.env.NODE_ENV === 'production' || process.env.AIONUI_CONTAINER === '1') {
        throw new Error('CODEX_RUNTIME_BUNDLE_MISSING');
      }
      execSync('bun run web:runtime:build', { cwd: repoRoot, stdio: 'inherit' });
    }
    process.env.AIONUI_CODEX_RUNTIME_ROOT = path.join(workDir, 'runtime', 'codex-cli');
    process.env.AIONUI_BUNDLED_CODEX = path.join(repoRoot, 'node_modules', '.bin', 'codex');
    process.env.PATH = [
      path.join(repoRoot, 'packages', 'web-host', 'src', 'runtime', 'codex'),
      process.env.PATH || '',
    ].join(path.delimiter);
  }
  const staticDir = resolveStaticDir();
  const backendBin = resolveBackendBinary();
  const logDir = process.env.AIONUI_LOG_DIR ?? path.join(workDir, 'logs');

  console.log('[webui] work dir   :', workDir);
  console.log('[webui] static dir :', staticDir);
  console.log('[webui] backend bin:', backendBin);
  console.log(`[webui] launching  : port=${port} allowRemote=${allowRemote}`);

  const handle = await startWebHost({
    app: {
      version: '0.0.0',
      isPackaged: false,
      resourcesPath: repoRoot,
      userDataPath: workDir,
      builtinSkillsDir: path.join(staticDir, 'builtin-skills'),
    },
    staticDir,
    port,
    allowRemote,
    dataDir: workDir,
    enableRuntimeControls: true,
    logDir,
    // Surface the same work dir on /api/system/info so the browser UI shows
    // where standalone webui is actually persisting data. Without this the
    // backend inherits process.env and may report the parent shell's cwd.
    dirs: {
      cacheDir: workDir,
      workDir: workDir,
      logDir,
    },
    backend: {
      kind: 'ownBackend',
      resolveBackend: () => backendBin,
    },
  });

  console.log('');
  console.log('AionUi WebUI is ready');
  console.log(`  Local  : ${handle.localUrl}`);
  if (handle.networkUrl) console.log(`  Network: ${handle.networkUrl}`);

  // If SQLite has no admin yet (fresh install), seed one via backend and print
  // the plaintext credentials. SQLite is the single source of truth.
  //
  // Username is surfaced explicitly: legacy dev databases may have the seeded
  // user as `system` instead of `admin`, and users can rename it via
  // Settings. Always read it from the backend rather than assuming a value.
  try {
    const statusRes = await fetch(`http://127.0.0.1:${handle.backendPort}/api/auth/status`);
    if (statusRes.ok) {
      const status = (await statusRes.json()) as { needs_setup?: boolean };
      if (status.needs_setup === true) {
        const initialPassword = resetWebUiPassword(backendBin, workDir);
        const adminUsername = readWebUiAdminUsername(backendBin, workDir);
        console.log('');
        console.log(`Initial admin username: ${adminUsername}`);
        console.log(`Initial admin password: ${initialPassword}`);
        console.log('(change them after first login)');
      } else {
        // Credentials already exist; just remind the user what username to use.
        const adminUsername = readWebUiAdminUsername(backendBin, workDir);
        console.log('');
        console.log(`Login username: ${adminUsername}`);
        console.log('(forgot the password? run `bun run resetpass` to generate a new one)');
      }
    }
  } catch (err) {
    console.warn('[webui] could not query admin credentials:', err);
  }

  if (autoOpenBrowser) {
    const openResult = openBrowserUrl(handle.localUrl);
    if (openResult.ok) {
      console.log(`[webui] opened ${handle.localUrl} in your browser.`);
    } else {
      console.warn(`[webui] could not open the browser automatically: ${openResult.reason}`);
    }
  }

  console.log('');
  console.log('Press Ctrl+C to stop.');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[webui] received ${signal}, stopping...`);
    try {
      await handle.stop();
    } catch (err) {
      console.error('[webui] stop error:', err);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[webui] failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
