#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Node/Bun CLI — resets the WebUI admin password for the standalone
 * `bun run webui` host (independent of Electron).
 *
 * After the M6 auth cleanup, SQLite `users` is the single source of truth.
 * Uses the Core account CLI directly, including while the server is running.
 * No unauthenticated password-reset HTTP endpoint is enabled.
 *
 * Usage:
 *   bun run resetpass                 # default work dir
 *   bun run resetpass --data-dir /x   # custom work dir
 *   AIONUI_DATA_DIR=/x bun run resetpass
 *   NODE_ENV=production bun run resetpass
 */

import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { resetWebUiPassword } from '@aionui/web-host';
import { resolveOpenUiCore } from '../packages/web-host/openui/core/resolve';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg: string) => console.log(`${colors.blue}i${colors.reset} ${msg}`),
  success: (msg: string) => console.log(`${colors.green}OK${colors.reset} ${msg}`),
  error: (msg: string) => console.log(`${colors.red}ERR${colors.reset} ${msg}`),
  warning: (msg: string) => console.log(`${colors.yellow}WARN${colors.reset} ${msg}`),
  highlight: (msg: string) => console.log(`${colors.cyan}${colors.bright}${msg}${colors.reset}`),
};

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const next = process.argv[idx + 1];
  return next && !next.startsWith('--') ? next : undefined;
}

/**
 * Same resolution as scripts/webui.ts:resolveBackendDataDir — keep both in sync
 * so `bun run webui` and `bun run resetpass` always target the same SQLite DB.
 * See the comment there for why the default is `~/.aionui-web*` (not `~/.aionui*`).
 */
function resolveWorkDir(): string {
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

// Skip flag values (e.g. `--data-dir /some/path`) so they don't get picked up
// as the username positional argument.
const FLAGS_WITH_VALUES = new Set(['--data-dir', '--port']);

function resolveUsername(): string | undefined {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      if (FLAGS_WITH_VALUES.has(a)) i++; // skip the flag's value too
      continue;
    }
    positional.push(a);
  }
  return positional[0];
}

async function main(): Promise<void> {
  try {
    const username = resolveUsername();
    const workDir = resolveWorkDir();
    const binary = resolveOpenUiCore(repoRoot);
    log.info(`Work dir: ${workDir}`);
    const password = resetWebUiPassword(binary, workDir, username);
    log.success('Password reset successfully.');
    log.highlight(password);
    log.warning('Restart the server to revoke existing sessions.');
  } catch (error) {
    log.error(error instanceof Error ? error.message : 'Password reset failed');
    process.exitCode = 1;
  }
}

void main();
