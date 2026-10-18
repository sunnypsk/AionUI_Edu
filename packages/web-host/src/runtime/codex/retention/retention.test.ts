import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexRetention } from './index.js';
import { writeInstallRecord } from './store.js';

describe.skipIf(process.platform === 'win32')('manual CLI version retention', () => {
  let data: string;
  let root: string;
  let ids: string[];
  const usage = { ids: new Set<string>(), complete: true };
  let retention: CodexRetention;

  beforeEach(async () => {
    data = await mkdtemp(path.join(os.tmpdir(), 'codex-retention-'));
    root = path.join(data, 'runtime', 'codex-cli');
    await mkdir(path.join(root, 'versions'), { recursive: true });
    vi.stubEnv('AIONUI_CODEX_RUNTIME_ROOT', root);
    ids = [];
    for (const version of ['0.160.0', '0.161.0', '0.162.0', '0.163.0']) {
      const id = `${version}-${randomUUID()}`;
      const directory = path.join(root, 'versions', id);
      await mkdir(directory);
      await writeInstallRecord(directory, { id, version, installedAt: '2026-10-19T00:00:00Z' });
      await writeFile(path.join(directory, 'payload'), 'CLI files');
      ids.push(id);
    }
    await symlink(`versions/${ids[3]}`, path.join(root, 'current'));
    usage.ids.clear();
    usage.complete = true;
    retention = new CodexRetention(data, async () => ({ ids: new Set(usage.ids), complete: usage.complete }));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(data, { recursive: true, force: true });
  });

  it('protects the latest two installations and any older active process', async () => {
    usage.ids.add(ids[0]);
    const inventory = await retention.inventory();
    expect(inventory.versions.map((entry) => [entry.version, entry.protection, entry.removable])).toEqual([
      ['0.163.0', 'selected', false],
      ['0.162.0', 'previous', false],
      ['0.161.0', null, true],
      ['0.160.0', 'inUse', false],
    ]);
  });

  it('only removes explicitly selected unused versions, preserving chats and memory', async () => {
    await mkdir(path.join(data, 'codex'));
    await writeFile(path.join(data, 'codex', 'memory.txt'), 'keep memory');
    const result = await retention.cleanup([ids[0], ids[2], ids[3]]);
    expect(result.removed).toEqual([ids[0]]);
    expect(await readdir(path.join(root, 'versions'))).toEqual(expect.arrayContaining(ids.slice(1)));
    expect(await readFile(path.join(data, 'codex', 'memory.txt'), 'utf8')).toBe('keep memory');
  });

  it('rechecks process use after the browser has loaded an eligible version', async () => {
    expect((await retention.inventory()).versions.find((entry) => entry.id === ids[0])?.removable).toBe(true);
    usage.ids.add(ids[0]);
    expect((await retention.cleanup([ids[0]])).removed).toEqual([]);
    expect(await readFile(path.join(root, 'versions', ids[0], 'payload'), 'utf8')).toBe('CLI files');
  });

  it('makes an older version eligible after its last process has exited', async () => {
    usage.ids.add(ids[0]);
    expect((await retention.inventory()).versions.find((entry) => entry.id === ids[0])?.removable).toBe(false);
    usage.ids.clear();
    expect((await retention.cleanup([ids[0]])).removed).toEqual([ids[0]]);
  });

  it('retains everything when process inspection is incomplete', async () => {
    usage.complete = false;
    const result = await retention.cleanup([ids[0], ids[1]]);
    expect(result.removed).toEqual([]);
    expect(result.inventory.inspectionComplete).toBe(false);
  });

  it('disables cleanup during an update without hiding the inventory', async () => {
    const inventory = await retention.inventory(true);
    expect(inventory.busy).toBe(true);
    expect(inventory.versions.some((entry) => entry.removable)).toBe(false);
  });

  it('never deletes an installation without verified updater provenance', async () => {
    await rm(path.join(root, 'versions', ids[0], '.aionui-install.json'));
    const result = await retention.cleanup([ids[0]]);
    expect(result.removed).toEqual([]);
    expect(result.inventory.versions.find((entry) => entry.id === ids[0])?.protection).toBe('unverified');
  });

  it('does not follow a version-directory symlink into unrelated data', async () => {
    const directory = path.join(root, 'versions', ids[0]);
    await rm(directory, { recursive: true });
    const unrelated = path.join(data, 'unrelated');
    await mkdir(unrelated);
    await writeFile(path.join(unrelated, 'keep'), 'keep');
    await symlink(unrelated, directory);
    expect((await retention.cleanup([ids[0]])).removed).toEqual([]);
    expect(await readFile(path.join(unrelated, 'keep'), 'utf8')).toBe('keep');
  });

  it('does not clean through a symlinked versions root', async () => {
    await rm(path.join(root, 'versions'), { recursive: true });
    await mkdir(path.join(data, 'outside'));
    await symlink(path.join(data, 'outside'), path.join(root, 'versions'));
    const result = await retention.cleanup([ids[0]]);
    expect(result.removed).toEqual([]);
    expect(result.inventory.inspectionComplete).toBe(false);
  });

  it('protects an older selected default even if newer installations exist', async () => {
    await rm(path.join(root, 'current'));
    await symlink(`versions/${ids[0]}`, path.join(root, 'current'));
    expect((await retention.cleanup([ids[0]])).removed).toEqual([]);
  });

  it.each(
    [['../codex'], ['/data/codex'], ['current'], [], Array(65).fill('invalid')].map((selection) => ({ selection }))
  )('rejects unsafe or invalid cleanup selections %#', async ({ selection }) => {
    await expect(retention.cleanup(selection as string[])).rejects.toThrow('INVALID_REQUEST');
  });
});
