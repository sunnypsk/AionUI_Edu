import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexRetention } from './index.js';
import { readUsage } from './leases.js';
import { writeInstallRecord } from './store.js';

describe.skipIf(process.platform === 'win32')('managed CLI process protection', () => {
  let data: string;
  let root: string;
  let ids: string[];
  let child: ChildProcess | undefined;
  let exited: Promise<number | null> | undefined;
  let output: string;

  beforeEach(async () => {
    data = await mkdtemp(path.join(os.tmpdir(), 'codex-lease-'));
    root = path.join(data, 'runtime', 'codex-cli');
    vi.stubEnv('AIONUI_CODEX_RUNTIME_ROOT', root);
    ids = [];
    output = '';
    for (const version of ['0.160.0', '0.161.0', '0.162.0']) {
      const id = `${version}-${randomUUID()}`;
      const directory = path.join(root, 'versions', id);
      await mkdir(path.join(directory, 'node_modules', '.bin'), { recursive: true });
      await writeInstallRecord(directory, { id, version, installedAt: new Date().toISOString() });
      const cli = path.join(directory, 'node_modules', '.bin', 'codex');
      await writeFile(
        cli,
        '#!/usr/bin/env node\nprocess.stdout.write("pool=" + process.env.TOKIO_WORKER_THREADS + "\\n"); process.stdin.resume(); process.on("SIGTERM", () => process.exit(0));\n'
      );
      await chmod(cli, 0o755);
      ids.push(id);
    }
    await symlink(`versions/${ids[0]}`, path.join(root, 'current'));
  });
  afterEach(async () => {
    child?.kill('SIGTERM');
    if (exited) await exited;
    child = undefined;
    exited = undefined;
    vi.unstubAllEnvs();
    await rm(data, { recursive: true, force: true });
  });

  async function start(withBrowser = false): Promise<void> {
    child = spawn(path.resolve('packages/web-host/src/runtime/codex/codex'), withBrowser ? ['app-server'] : [], {
      env: {
        ...process.env,
        AIONUI_BUNDLED_CODEX: '/unavailable-bundled-codex',
        ...(withBrowser
          ? {
              AIONUI_BROWSER_SIGNING_KEY: 'fixture-key',
              AIONUI_BROWSER_GATEWAY: 'http://127.0.0.1:1/command',
              AIONUI_USER_ID: 'teacher',
              AIONUI_CONVERSATION_ID: 'task',
              AIONUI_RUNTIME_TOKEN: 'fixture-token',
            }
          : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    exited = new Promise((resolve) => child!.once('exit', resolve));
    await new Promise<void>((resolve, reject) => {
      child!.once('error', reject);
      child!.stdout!.once('data', (data: Buffer) => {
        output = data.toString();
        resolve();
      });
      child!.once('exit', (code) => {
        if (code !== null) reject(new Error(`CLI exited early: ${code}`));
      });
    });
    const next = path.join(root, 'next');
    await symlink(`versions/${ids[2]}`, next);
    await rename(next, path.join(root, 'current'));
  }

  it('defaults CLI worker threads to four without changing an explicit override', async () => {
    vi.stubEnv('TOKIO_WORKER_THREADS', '');
    await start();
    expect(output).toBe('pool=4\n');
    child!.kill('SIGTERM');
    await exited;
    vi.stubEnv('TOKIO_WORKER_THREADS', '2');
    await start();
    expect(output).toBe('pool=2\n');
  });

  it('releases its lease when the selected CLI cannot be started', async () => {
    await rm(path.join(root, 'versions', ids[0], 'node_modules', '.bin', 'codex'));
    child = spawn(path.resolve('packages/web-host/src/runtime/codex/codex'), [], {
      env: { ...process.env, AIONUI_BUNDLED_CODEX: '/unavailable-bundled-codex' },
      stdio: 'ignore',
    });
    exited = new Promise((resolve) => child!.once('exit', resolve));
    expect(await exited).toBe(1);
    expect(await readdir(path.join(root, 'leases'))).toEqual([]);
  });

  it('keeps an older real process alive while newer unused files are removed', async () => {
    await start();
    // Add another newest installation so 0.161 becomes a cleanup candidate.
    const id = `0.163.0-${randomUUID()}`;
    const directory = path.join(root, 'versions', id);
    await mkdir(directory);
    await writeInstallRecord(directory, { id, version: '0.163.0', installedAt: new Date().toISOString() });
    const result = await new CodexRetention(data).cleanup([ids[0], ids[1]]);
    expect(result.removed).toEqual([ids[1]]);
    expect(child!.exitCode).toBeNull();
    expect((await readUsage(root)).ids.has(ids[0])).toBe(true);
  });

  it('forwards termination and releases the lease after the CLI exits', async () => {
    await start();
    child!.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(await readdir(path.join(root, 'leases'))).toEqual([]);
    expect((await readUsage(root)).ids.has(ids[0])).toBe(false);
  });

  it('still detects the native process if its lease is missing', async () => {
    await start();
    for (const file of await readdir(path.join(root, 'leases'))) await rm(path.join(root, 'leases', file));
    expect((await readUsage(root)).ids.has(ids[0])).toBe(true);
  });

  it('protects the active CLI behind the browser proxy even if its lease is missing', async () => {
    await start(true);
    for (const file of await readdir(path.join(root, 'leases'))) await rm(path.join(root, 'leases', file));
    expect((await readUsage(root)).ids.has(ids[0])).toBe(true);
    child!.kill('SIGTERM');
    expect(await exited).toBe(0);
  });

  it('blocks cleanup for a malformed lease instead of assuming it is idle', async () => {
    await mkdir(path.join(root, 'leases'));
    await writeFile(path.join(root, 'leases', `${process.pid}-${randomUUID()}.json`), '{}');
    expect((await readUsage(root)).complete).toBe(false);
    expect(await readFile(path.join(root, 'versions', ids[0], '.aionui-install.json'), 'utf8')).toContain(ids[0]);
  });
});
