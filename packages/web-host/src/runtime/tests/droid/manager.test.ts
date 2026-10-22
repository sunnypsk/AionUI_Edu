import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DroidStreamEvent } from '@factory/droid-sdk/node';
import { SpecialistManager } from '../../droid/manager.js';
import type { SpecialistProvider, SpecialistSession } from '../../droid/provider/index.js';
import type { Owner, StoredTask } from '../../droid/types.js';

const result = (text: string): DroidStreamEvent => ({
  type: 'result',
  subtype: 'success',
  success: true,
  interrupted: false,
  error: null,
  text,
  sessionId: 'native',
  durationMs: 1,
  tokenUsage: null,
  messages: [],
  turnCount: 1,
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
describe('host-owned writing specialists', () => {
  let directory: string;
  let owner: Owner;
  let manager: SpecialistManager;
  let initialize: ReturnType<typeof deferred> | undefined;
  let finish: ReturnType<typeof deferred> | undefined;
  const opens: { id: string; sessionId?: string; model: string }[] = [];
  let stream: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'aion-specialists-'));
    owner = { userId: 'teacher', conversationId: 'lesson', workspace: directory };
    initialize = undefined;
    finish = undefined;
    opens.length = 0;
    stream = vi.fn();
    const provider: SpecialistProvider = {
      open: async (task: StoredTask, signal): Promise<SpecialistSession> => {
        opens.push({ id: task.id, sessionId: task.sessionId, model: task.model });
        if (initialize)
          await Promise.race([
            initialize.promise,
            new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
          ]);
        return {
          id: task.sessionId ?? randomUUID(),
          disabledToolIds: ['Read', 'Execute'],
          close: async () => {
            finish?.resolve();
          },
          stream: async function* (prompt) {
            stream(prompt);
            yield { type: 'assistant_text_delta', messageId: 'draft', blockIndex: 0, text: '保留原稿😀' };
            if (finish)
              await Promise.race([
                finish.promise,
                new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
              ]);
            yield result(prompt.startsWith('long') ? '自然中文😀'.repeat(10000) : '保留原稿😀');
          },
        };
      },
    };
    manager = new SpecialistManager(directory, provider);
    await manager.parentStart(owner, 'request-1', 'parent');
    await manager.parentBound(owner, 'request-1', 'turn-1');
  });
  afterEach(async () => {
    initialize?.resolve();
    finish?.resolve();
    await manager.close();
    await rm(directory, { recursive: true, force: true });
  });
  const complete = async (id: string): Promise<void> => {
    await vi.waitFor(async () => {
      expect((await manager.get(owner, id)).task.runs.at(-1)?.status).toBe('completed');
    });
    await vi.waitFor(() => expect(stream).toHaveBeenCalled());
  };
  it('preserves native identity and original Chinese through follow-up', async () => {
    const task = await manager.start(owner, 'opus', 'Write a story');
    await complete(task.id);
    await vi.waitFor(async () => {
      await manager.reply(owner, task.id, 'Make it conversational');
    });
    await complete(task.id);
    expect(opens[1].sessionId).toBeTruthy();
    expect((await manager.get(owner, task.id)).text).toBe('保留原稿😀');
    expect((await manager.get(owner, task.id)).task.runs).toHaveLength(2);
  });
  it('stops initialization before it can send any prompt', async () => {
    initialize = deferred();
    const task = await manager.start(owner, 'argon', 'text');
    await vi.waitFor(() => expect(opens).toHaveLength(1));
    await manager.cancelConversation(owner.conversationId);
    initialize.resolve();
    await vi.waitFor(async () => expect((await manager.get(owner, task.id)).task.runs[0].status).toBe('canceled'));
    expect(stream).not.toHaveBeenCalled();
    await expect(manager.start(owner, 'opus', 'late')).rejects.toThrow('SPECIALIST_PARENT_STOPPED');
  });
  it('does not let a late Stop response cancel a new parent generation', async () => {
    const oldEpoch = await manager.epoch(owner.conversationId);
    await manager.parentStart(owner, 'request-2', 'parent');
    finish = deferred();
    const task = await manager.start(owner, 'argon', 'new');
    await manager.cancelConversation(owner.conversationId, oldEpoch);
    finish.resolve();
    await complete(task.id);
  });
  it('ignores child-thread interrupts and deduplicates old start events after Stop', async () => {
    finish = deferred();
    const task = await manager.start(owner, 'argon', 'text');
    await manager.parentStop(owner, 'child', 'turn-1');
    expect((await manager.get(owner, task.id)).task.runs[0].status).not.toBe('canceled');
    await manager.parentStop(owner, 'parent', 'turn-1');
    await manager.parentStart(owner, 'request-1', 'parent');
    await expect(manager.start(owner, 'opus', 'late')).rejects.toThrow('SPECIALIST_PARENT_STOPPED');
  });
  it('enforces conversation limits and rejects replies to busy sessions', async () => {
    finish = deferred();
    const task = await manager.start(owner, 'argon', 'one');
    await manager.start(owner, 'opus', 'two');
    await expect(manager.start(owner, 'opus', 'three')).rejects.toThrow('SPECIALIST_LIMIT');
    await expect(manager.reply(owner, task.id, 'overlap')).rejects.toThrow('SPECIALIST_BUSY');
  });
  it('aborting a wait leaves both independent tasks running', async () => {
    finish = deferred();
    const one = await manager.start(owner, 'argon', 'one');
    const two = await manager.start(owner, 'opus', 'two');
    const abort = new AbortController();
    const wait = manager.wait(owner, [one.id, two.id], 50, abort.signal);
    abort.abort();
    await wait;
    expect((await manager.list(owner)).every((task) => ['initializing', 'running'].includes(task.runs[0].status))).toBe(
      true
    );
  });
  it('retrieves long text without consuming it or splitting surrogate pairs', async () => {
    const task = await manager.start(owner, 'argon', 'long');
    await complete(task.id);
    let text = '';
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await manager.get(owner, task.id, undefined, offset);
      text += page.text;
      offset = page.nextOffset;
    }
    expect(text).toBe('自然中文😀'.repeat(10000));
    expect((await manager.get(owner, task.id)).text).toBe(text.slice(0, 24000));
  });
  it('keeps results after host restart and never replays interrupted work', async () => {
    const completed = await manager.start(owner, 'argon', 'one');
    await complete(completed.id);
    finish = deferred();
    const interrupted = await manager.start(owner, 'opus', 'two');
    await manager.close();
    const provider = { open: vi.fn() } as unknown as SpecialistProvider;
    manager = new SpecialistManager(directory, provider);
    expect((await manager.get(owner, completed.id)).text).toBe('保留原稿😀');
    expect((await manager.get(owner, interrupted.id)).task.runs[0].error).toBe('SPECIALIST_HOST_RESTARTED');
    expect(provider.open).not.toHaveBeenCalled();
  });
  it('does not disclose drafts across users or conversations', async () => {
    const task = await manager.start(owner, 'argon', 'text');
    await expect(manager.get({ ...owner, userId: 'other' }, task.id)).rejects.toThrow('SPECIALIST_TASK_NOT_FOUND');
    await expect(manager.get({ ...owner, conversationId: 'other' }, task.id)).rejects.toThrow(
      'SPECIALIST_TASK_NOT_FOUND'
    );
  });
  it('does not overwrite an unreadable persistent store on shutdown', async () => {
    await manager.close();
    await writeFile(path.join(directory, 'droid', 'index.json'), 'broken');
    manager = new SpecialistManager(directory, { open: vi.fn() });
    await expect(manager.list(owner)).rejects.toThrow('SPECIALIST_STORE_INVALID');
    await manager.close();
    expect(await readFile(path.join(directory, 'droid', 'index.json'), 'utf8')).toBe('broken');
  });
  it('fails missing source material before launching a paid turn', async () => {
    await mkdir(path.join(directory, 'empty'));
    const task = await manager.start(owner, 'argon', 'text', ['missing.txt']);
    await vi.waitFor(async () => expect((await manager.get(owner, task.id)).task.runs[0].status).toBe('failed'));
    expect(opens).toHaveLength(0);
  });
});
