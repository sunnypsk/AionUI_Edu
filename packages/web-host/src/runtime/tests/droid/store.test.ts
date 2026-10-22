import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpecialistStore } from '../../droid/store.js';
import type { State, StoredTask } from '../../droid/types.js';

const io = vi.hoisted(() => ({ beforeRename: vi.fn<(source: string, target: string) => Promise<void>>() }));
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    rename: async (source: string, target: string) => {
      await io.beforeRename(source, target);
      return actual.rename(source, target);
    },
  };
});

const task = (id: string): StoredTask => ({
  id,
  specialist: 'argon',
  model: 'test-model',
  reasoningEffort: 'low',
  createdAt: 1,
  userId: 'user',
  conversationId: 'conversation',
  epoch: 1,
  disabledToolIds: [],
  runs: [{ id: 'run', status: 'completed', text: 'x'.repeat(4096), createdAt: 1 }],
});
const state = (count = 1): State => ({
  version: 1,
  tasks: Array.from({ length: count }, (_, i) => task(`task-${i}`)),
  gates: {},
});
let directory: string;
beforeEach(async () => {
  io.beforeRename.mockReset();
  directory = await mkdtemp(path.join(os.tmpdir(), 'specialist-store-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('specialist task persistence', () => {
  it('rejects a corrupt legacy store without overwriting it', async () => {
    await writeFile(path.join(directory, 'tasks.json'), 'broken');
    await expect(new SpecialistStore(directory).load()).rejects.toThrow('SPECIALIST_STORE_INVALID');
    expect(await readFile(path.join(directory, 'tasks.json'), 'utf8')).toBe('broken');
  });
  it('preserves the legacy snapshot through an interrupted migration', async () => {
    const original = JSON.stringify(state(2));
    await writeFile(path.join(directory, 'tasks.json'), original);
    const store = new SpecialistStore(directory);
    const loaded = await store.load();
    io.beforeRename.mockImplementation(async (_source, target) => {
      if (target.endsWith('index.json')) throw new Error('disk failure');
    });
    await expect(store.save(loaded)).rejects.toThrow('disk failure');
    expect(await new SpecialistStore(directory).load()).toEqual(loaded);
    io.beforeRename.mockReset();
    await store.save(loaded);
    expect(await new SpecialistStore(directory).load()).toEqual(loaded);
    expect(await readFile(path.join(directory, 'tasks.json'), 'utf8')).toBe(original);
  });

  it('writes only the changed task instead of serializing the full history', async () => {
    const store = new SpecialistStore(directory);
    const history = state(100);
    await store.save(history);
    let bytes = 0;
    io.beforeRename.mockClear().mockImplementation(async (source) => {
      bytes += (await stat(source)).size;
    });
    history.tasks[0].runs[0].text = 'updated';
    await store.save(history, ['task-0']);
    expect(io.beforeRename).toHaveBeenCalledTimes(2);
    expect(bytes).toBeLessThan(Buffer.byteLength(JSON.stringify(history)) / 100);
    expect((await new SpecialistStore(directory).load()).tasks[99]).toEqual(history.tasks[99]);
  });

  it('coalesces waiting snapshots and captures mutable state at save time', async () => {
    const store = new SpecialistStore(directory);
    const history = state();
    await store.save(history);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    io.beforeRename.mockReset().mockImplementationOnce(async () => {
      entered();
      await held;
    });
    history.tasks[0].runs[0].text = 'first';
    const first = store.save(history, ['task-0']);
    await started;
    history.tasks[0].runs[0].text = 'second';
    const second = store.save(history, ['task-0']);
    history.tasks[0].runs[0].text = 'latest';
    const latest = store.save(history, ['task-0']);
    history.tasks[0].runs[0].text = 'unsaved';
    release();
    await Promise.all([first, second, latest]);
    expect(io.beforeRename).toHaveBeenCalledTimes(4);
    expect((await new SpecialistStore(directory).load()).tasks[0].runs[0].text).toBe('latest');
  });

  it('keeps the last atomic task file when replacement fails', async () => {
    const store = new SpecialistStore(directory);
    const history = state();
    await store.save(history);
    const previous = history.tasks[0].runs[0].text;
    history.tasks[0].runs[0].text = 'uncommitted';
    io.beforeRename.mockRejectedValueOnce(new Error('disk failure'));
    await expect(store.save(history, ['task-0'])).rejects.toThrow('disk failure');
    expect((await new SpecialistStore(directory).load()).tasks[0].runs[0].text).toBe(previous);
    expect((await readdir(path.join(directory, 'tasks'))).some((name) => name.endsWith('.tmp'))).toBe(false);
  });
});
