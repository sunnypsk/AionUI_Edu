import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { SpecialistStore } from './store.js';
import {
  active,
  errorCode,
  MODELS,
  type Owner,
  type State,
  type StoredTask,
  type SpecialistTask,
  type Specialist,
  type SpecialistPage,
} from './types.js';
import { FactoryProvider, sourceMaterial, type SpecialistProvider, type SpecialistSession } from './provider/index.js';

type Work = { controller: AbortController; session?: SpecialistSession; done: Promise<void> };
const PAGE_SIZE = 24000;
const publicTask = (task: StoredTask): SpecialistTask => ({
  id: task.id,
  specialist: task.specialist,
  model: task.model,
  createdAt: task.createdAt,
  runs: task.runs.map((run) => ({ ...run, text: '' })),
});

/** Host-owned sessions outlive MCP processes. State transitions never hold a lock over SDK IO. */
export class SpecialistManager {
  private state: State = { version: 1, tasks: [], gates: {} };
  private readonly store: SpecialistStore;
  private readonly ready: Promise<void>;
  private readonly work = new Map<string, Work>();
  private readonly listeners = new Set<() => void>();
  private checkpoint?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(
    dataDir: string,
    private readonly provider: SpecialistProvider = new FactoryProvider(dataDir)
  ) {
    this.store = new SpecialistStore(path.join(dataDir, 'droid'));
    this.ready = this.store.load().then(async (state) => {
      this.state = state;
      for (const gate of Object.values(state.gates)) gate.open = false;
      for (const task of state.tasks)
        if (active(task))
          Object.assign(task.runs.at(-1)!, {
            status: 'failed',
            error: 'SPECIALIST_HOST_RESTARTED',
            finishedAt: Date.now(),
          });
      await this.persist();
    });
    void this.ready.catch(() => {});
  }
  private persist(): Promise<void> {
    return this.store.save(this.state);
  }
  private changed(): void {
    for (const listener of this.listeners) listener();
  }
  private gateKey(owner: Pick<Owner, 'userId' | 'conversationId'>): string {
    return `${owner.userId}:${owner.conversationId}`;
  }
  private gate(owner: Pick<Owner, 'userId' | 'conversationId'>) {
    return (this.state.gates[this.gateKey(owner)] ??= { epoch: 0, open: false, turns: {} });
  }
  private find(owner: Owner, id: string): StoredTask {
    const task = this.state.tasks.find(
      (item) => item.id === id && item.userId === owner.userId && item.conversationId === owner.conversationId
    );
    if (!task) throw new Error('SPECIALIST_TASK_NOT_FOUND');
    return task;
  }
  private admit(owner: Owner): number {
    if (this.closed) throw new Error('SPECIALIST_UNAVAILABLE');
    const gate = this.gate(owner);
    if (!gate.open) throw new Error('SPECIALIST_PARENT_STOPPED');
    if (
      this.state.tasks.filter((task) => task.userId === owner.userId && active(task)).length >= 4 ||
      this.state.tasks.filter(
        (task) => task.userId === owner.userId && task.conversationId === owner.conversationId && active(task)
      ).length >= 2
    )
      throw new Error('SPECIALIST_LIMIT');
    return gate.epoch;
  }

  async parentStart(owner: Owner, eventId: string, threadId: string): Promise<void> {
    await this.ready;
    const gate = this.gate(owner);
    if (gate.turns[eventId] !== undefined) return;
    gate.epoch += 1;
    gate.open = true;
    gate.eventId = eventId;
    gate.threadId = threadId;
    gate.turns[eventId] = gate.epoch;
    const keys = Object.keys(gate.turns);
    for (const key of keys.slice(0, Math.max(0, keys.length - 256))) delete gate.turns[key];
    await this.persist();
  }
  async parentBound(owner: Owner, eventId: string, turnId: string): Promise<void> {
    await this.ready;
    const gate = this.gate(owner);
    const epoch = gate.turns[eventId];
    if (epoch !== undefined) {
      gate.turns[turnId] = epoch;
      await this.persist();
    }
  }
  async parentStop(owner: Owner, threadId: string, turnId: string): Promise<void> {
    await this.ready;
    const gate = this.gate(owner);
    if (gate.threadId !== threadId || gate.turns[turnId] === undefined) return;
    await this.cancelConversation(owner.conversationId, gate.turns[turnId], owner.userId);
  }
  async epoch(conversationId: string): Promise<number> {
    await this.ready;
    return Math.max(
      0,
      ...Object.entries(this.state.gates)
        .filter(([key]) => key.endsWith(`:${conversationId}`))
        .map(([, gate]) => gate.epoch)
    );
  }
  async start(owner: Owner, specialist: Specialist, prompt: string, files?: string[]): Promise<SpecialistTask> {
    await this.ready;
    const epoch = this.admit(owner);
    const task: StoredTask = {
      id: randomUUID(),
      userId: owner.userId,
      conversationId: owner.conversationId,
      specialist,
      model: MODELS[specialist],
      epoch,
      createdAt: Date.now(),
      disabledToolIds: [],
      runs: [],
    };
    this.state.tasks.push(task);
    return this.launch(owner, task, prompt, files);
  }
  async reply(owner: Owner, taskId: string, prompt: string, files?: string[]): Promise<SpecialistTask> {
    await this.ready;
    const task = this.find(owner, taskId);
    if (active(task) || this.work.has(taskId)) throw new Error('SPECIALIST_BUSY');
    task.epoch = this.admit(owner);
    if (!task.sessionId) throw new Error('SPECIALIST_SESSION_UNAVAILABLE');
    return this.launch(owner, task, prompt, files);
  }
  private async launch(owner: Owner, task: StoredTask, prompt: string, files?: string[]): Promise<SpecialistTask> {
    task.runs.push({ id: randomUUID(), status: 'initializing', text: '', createdAt: Date.now() });
    const work: Work = { controller: new AbortController(), done: Promise.resolve() };
    this.work.set(task.id, work);
    work.done = this.persist()
      .then(() => this.execute(owner, task, work, prompt, files))
      .catch(async (error: unknown) => {
        if (active(task))
          Object.assign(task.runs.at(-1)!, { status: 'failed', error: errorCode(error), finishedAt: Date.now() });
        await this.persist().catch(() => {});
      })
      .finally(() => {
        this.work.delete(task.id);
        this.changed();
      });
    this.changed();
    return publicTask(task);
  }
  private async execute(owner: Owner, task: StoredTask, work: Work, prompt: string, files?: string[]): Promise<void> {
    const run = task.runs.at(-1)!;
    const check = (): void => {
      work.controller.signal.throwIfAborted();
      if (!active(task) || this.closed) throw new Error('SPECIALIST_PARENT_STOPPED');
    };
    const timeout = setTimeout(
      () => {
        run.error = 'SPECIALIST_TIMEOUT';
        work.controller.abort();
      },
      15 * 60 * 1000
    );
    try {
      check();
      const sources = await sourceMaterial(owner.workspace, files);
      check();
      work.session = await this.provider.open(task, work.controller.signal);
      check();
      task.sessionId = work.session.id;
      task.disabledToolIds = work.session.disabledToolIds;
      await this.persist();
      check();
      run.status = 'running';
      this.changed();
      let terminal = false;
      const parts = new Map<string, string>();
      for await (const event of work.session.stream(`${prompt}${sources}`)) {
        check();
        if (['tool_call', 'tool_result', 'tool_call_delta', 'hook'].includes(event.type))
          throw new Error('SPECIALIST_TOOLS_NOT_ISOLATED');
        if (event.type === 'assistant_text_delta')
          parts.set(event.messageId, (parts.get(event.messageId) ?? '') + event.text);
        else if (event.type === 'assistant_message_retracted') parts.delete(event.messageId);
        else if (event.type === 'assistant') parts.set(event.message.id, event.text);
        if (
          event.type === 'assistant_text_delta' ||
          event.type === 'assistant_message_retracted' ||
          event.type === 'assistant'
        ) {
          run.text = [...parts.values()].join('\n\n');
          if (Buffer.byteLength(run.text) > 8 * 1024 * 1024) throw new Error('SPECIALIST_OUTPUT_LIMIT');
          this.scheduleCheckpoint();
        }
        if (event.type === 'result') {
          if (Buffer.byteLength(event.text ?? '') > 8 * 1024 * 1024) throw new Error('SPECIALIST_OUTPUT_LIMIT');
          terminal = true;
          run.text = event.text || run.text;
          run.status = event.success ? 'completed' : event.interrupted ? 'canceled' : 'failed';
          if (event.tokenUsage)
            run.usage = Object.fromEntries(
              Object.entries(event.tokenUsage).filter(
                (entry): entry is [string, number] => typeof entry[1] === 'number'
              )
            );
          if (run.status === 'failed')
            run.error = errorCode(new Error(event.error?.message ?? 'SPECIALIST_GENERATION_FAILED'));
          break;
        }
      }
      if (!terminal) throw new Error('SPECIALIST_STREAM_INCOMPLETE');
    } catch (error) {
      if (active(task)) {
        run.status = 'failed';
        run.error ??= errorCode(error);
      }
    } finally {
      clearTimeout(timeout);
      run.finishedAt ??= Date.now();
      await work.session?.close().catch(() => {});
      await this.persist();
      this.changed();
    }
  }
  private scheduleCheckpoint(): void {
    if (this.checkpoint) return;
    this.checkpoint = setTimeout(() => {
      this.checkpoint = undefined;
      void this.persist().catch(() => {
        void this.close();
      });
    }, 1000);
  }
  async list(owner: Owner): Promise<SpecialistTask[]> {
    await this.ready;
    return this.state.tasks
      .filter((task) => task.userId === owner.userId && task.conversationId === owner.conversationId)
      .map(publicTask);
  }
  async get(owner: Owner, id: string, runId?: string, offset = 0): Promise<SpecialistPage> {
    await this.ready;
    const task = this.find(owner, id);
    const run = runId ? task.runs.find((item) => item.id === runId) : task.runs.at(-1);
    if (!run || offset < 0 || !Number.isInteger(offset)) throw new Error('INVALID_REQUEST');
    let end = Math.min(run.text.length, offset + PAGE_SIZE);
    if (end < run.text.length && /[\uD800-\uDBFF]/.test(run.text.charAt(end - 1))) end -= 1;
    return {
      task: publicTask(task),
      runId: run.id,
      text: run.text.slice(offset, end),
      nextOffset: end < run.text.length ? end : null,
      totalLength: run.text.length,
    };
  }
  async wait(owner: Owner, ids: string[], seconds: number, signal?: AbortSignal): Promise<SpecialistPage[]> {
    await this.ready;
    const tasks = ids.map((id) => this.find(owner, id));
    if (tasks.every(active) && seconds > 0 && !signal?.aborted)
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          this.listeners.delete(changed);
          signal?.removeEventListener('abort', done);
          resolve();
        };
        const changed = (): void => {
          if (tasks.some((task) => !active(task))) done();
        };
        const timer = setTimeout(done, Math.min(seconds, 50) * 1000);
        this.listeners.add(changed);
        signal?.addEventListener('abort', done, { once: true });
        changed();
      });
    return Promise.all(ids.map((id) => this.get(owner, id)));
  }
  private cancelTask(task: StoredTask): void {
    if (!active(task)) return;
    Object.assign(task.runs.at(-1)!, { status: 'canceled', finishedAt: Date.now() });
    this.work.get(task.id)?.controller.abort();
    const session = this.work.get(task.id)?.session;
    if (session) void session.close().catch(() => {});
    this.changed();
  }
  async cancel(owner: Owner, id: string): Promise<SpecialistTask> {
    await this.ready;
    const task = this.find(owner, id);
    this.cancelTask(task);
    await this.persist();
    return publicTask(task);
  }
  async cancelConversation(conversationId: string, epoch = Number.MAX_SAFE_INTEGER, userId?: string): Promise<void> {
    await this.ready;
    for (const [key, gate] of Object.entries(this.state.gates))
      if (
        key.endsWith(`:${conversationId}`) &&
        (!userId || key === `${userId}:${conversationId}`) &&
        gate.epoch <= epoch
      )
        gate.open = false;
    for (const task of this.state.tasks)
      if (task.conversationId === conversationId && (!userId || task.userId === userId) && task.epoch <= epoch)
        this.cancelTask(task);
    await this.persist();
  }
  async cancelUser(userId: string): Promise<void> {
    await this.ready;
    for (const [key, gate] of Object.entries(this.state.gates)) if (key.startsWith(`${userId}:`)) gate.open = false;
    for (const task of this.state.tasks) if (task.userId === userId) this.cancelTask(task);
    await this.persist();
    await Promise.all(
      [...this.work.entries()]
        .filter(([id]) => this.state.tasks.some((task) => task.id === id && task.userId === userId))
        .map(([, work]) => work.done)
    );
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.checkpoint);
    try {
      await this.ready;
    } catch {
      return;
    }
    for (const task of this.state.tasks)
      if (active(task)) {
        Object.assign(task.runs.at(-1)!, {
          status: 'failed',
          error: 'SPECIALIST_HOST_RESTARTED',
          finishedAt: Date.now(),
        });
        this.work.get(task.id)?.controller.abort();
      }
    await Promise.all([...this.work.values()].map((work) => work.done));
    await this.persist();
    this.changed();
  }
}
