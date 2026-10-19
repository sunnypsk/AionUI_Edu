import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findUsedVersions, inspectProcesses } from './processes.js';

describe('managed process path detection', () => {
  const root = '/data/runtime/codex-cli';
  const id = '0.163.0-12345678-1234-1234-1234-123456789abc';
  it('recognises native executable paths and NUL-separated CLI arguments', () => {
    expect([
      ...findUsedVersions(`/usr/bin/node\0${root}/versions/${id}/node_modules/.bin/codex\0app-server`, root),
    ]).toEqual([id]);
  });
  it('does not treat arbitrary paths or invalid directory names as an owned CLI', () => {
    expect([...findUsedVersions(`${root}/versions/../../codex ${root}-other/versions/${id}/codex`, root)]).toEqual([]);
  });
});

describe.skipIf(process.platform === 'win32')('Linux process inspection', () => {
  let proc: string;
  const root = '/data/runtime/codex-cli';
  const id = '0.160.0-12345678-1234-1234-1234-123456789abc';
  beforeEach(async () => {
    proc = await mkdtemp(path.join(os.tmpdir(), 'codex-proc-'));
    await mkdir(path.join(proc, '123'));
    await writeFile(path.join(proc, '123', 'comm'), 'codex\n');
    await writeFile(path.join(proc, '123', 'cmdline'), 'codex\0app-server');
    await symlink(`${root}/versions/${id}/node_modules/native/codex`, path.join(proc, '123', 'exe'));
  });
  afterEach(async () => {
    await rm(proc, { recursive: true, force: true });
  });

  it('detects a native managed executable through procfs', async () => {
    const usage = await inspectProcesses(root, 'linux', proc);
    expect([...usage.ids]).toEqual([id]);
    expect(usage.complete).toBe(true);
  });
  it.each(['MainThread', 'node-MainThread'])(
    'detects a managed script when Node uses %s as its thread name',
    async (comm) => {
      await writeFile(path.join(proc, '123', 'comm'), comm + '\n');
      await rm(path.join(proc, '123', 'exe'));
      await symlink('/usr/bin/node', path.join(proc, '123', 'exe'));
      await writeFile(
        path.join(proc, '123', 'cmdline'),
        `/usr/bin/node\0${root}/versions/${id}/node_modules/.bin/codex\0app-server`
      );
      const usage = await inspectProcesses(root, 'linux', proc);
      expect([...usage.ids]).toEqual([id]);
      expect(usage.complete).toBe(true);
    }
  );
  it('does not protect an unrelated Node main thread', async () => {
    await writeFile(path.join(proc, '123', 'comm'), 'MainThread\n');
    await rm(path.join(proc, '123', 'exe'));
    await symlink('/usr/bin/node', path.join(proc, '123', 'exe'));
    await writeFile(path.join(proc, '123', 'cmdline'), '/usr/bin/node\0/unmanaged/server.js');
    const usage = await inspectProcesses(root, 'linux', proc);
    expect([...usage.ids]).toEqual([]);
    expect(usage.complete).toBe(true);
  });
  it('blocks cleanup when a candidate process cannot be inspected reliably', async () => {
    await rm(path.join(proc, '123', 'exe'));
    await writeFile(path.join(proc, '123', 'exe'), 'not a procfs symlink');
    expect((await inspectProcesses(root, 'linux', proc)).complete).toBe(false);
  });
  it('tolerates a process that exits while procfs is being scanned', async () => {
    await mkdir(path.join(proc, '456'));
    expect((await inspectProcesses(root, 'linux', proc)).complete).toBe(true);
  });
  it('does not require inspecting root-owned non-CLI infrastructure', async () => {
    await writeFile(path.join(proc, '123', 'comm'), 'sing-box\n');
    await rm(path.join(proc, '123', 'exe'));
    expect((await inspectProcesses(root, 'linux', proc)).complete).toBe(true);
  });
});
