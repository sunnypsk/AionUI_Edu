import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { State, StoredTask } from './types.js';

type Index = { version: 2; tasks: string[]; gates: State['gates'] };
type PendingWrite = {
  tasks: Map<string, string>;
  index: string;
  waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
};

/** Atomic task files with a small index; pending updates retain only the newest version of each task. */
export class SpecialistStore {
  private partitioned = false;
  private pending?: PendingWrite;
  private draining = false;
  constructor(private readonly directory: string) {}

  private taskPath(id: string): string {
    return path.join(this.directory, 'tasks', `${createHash('sha256').update(id).digest('hex')}.json`);
  }

  async load(): Promise<State> {
    try {
      let index: Index;
      try {
        index = JSON.parse(await readFile(path.join(this.directory, 'index.json'), 'utf8')) as Index;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return await this.loadLegacy();
      }
      if (
        index.version !== 2 ||
        !Array.isArray(index.tasks) ||
        index.tasks.some((id) => typeof id !== 'string') ||
        new Set(index.tasks).size !== index.tasks.length ||
        !index.gates ||
        typeof index.gates !== 'object'
      )
        throw new Error('SPECIALIST_STORE_INVALID');
      const tasks: StoredTask[] = [];
      // Bound startup IO even for a long history.
      for (let offset = 0; offset < index.tasks.length; offset += 8) {
        tasks.push(
          ...(await Promise.all(
            index.tasks.slice(offset, offset + 8).map(async (id) => {
              const task = JSON.parse(await readFile(this.taskPath(id), 'utf8')) as StoredTask;
              if (task.id !== id || !Array.isArray(task.runs)) throw new Error('SPECIALIST_STORE_INVALID');
              return task;
            })
          ))
        );
      }
      this.partitioned = true;
      return { version: 1, tasks, gates: index.gates };
    } catch {
      throw new Error('SPECIALIST_STORE_INVALID');
    }
  }

  private async loadLegacy(): Promise<State> {
    try {
      const value = JSON.parse(await readFile(path.join(this.directory, 'tasks.json'), 'utf8')) as State;
      if (value.version !== 1 || !Array.isArray(value.tasks) || !value.gates || typeof value.gates !== 'object')
        throw new Error('SPECIALIST_STORE_INVALID');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, tasks: [], gates: {} };
      throw error;
    }
  }

  save(state: State, dirtyTaskIds?: Iterable<string>): Promise<void> {
    const dirty = this.partitioned && dirtyTaskIds ? new Set(dirtyTaskIds) : null;
    const tasks = new Map(
      state.tasks.filter((task) => !dirty || dirty.has(task.id)).map((task) => [task.id, JSON.stringify(task)])
    );
    const index = JSON.stringify({
      version: 2,
      tasks: state.tasks.map((task) => task.id),
      gates: state.gates,
    } satisfies Index);
    return new Promise((resolve, reject) => {
      if (this.pending) {
        for (const [id, json] of tasks) this.pending.tasks.set(id, json);
        this.pending.index = index;
        this.pending.waiters.push({ resolve, reject });
      } else this.pending = { tasks, index, waiters: [{ resolve, reject }] };
      if (!this.draining) void this.drain();
    });
  }

  private async writeAtomic(target: string, json: string): Promise<void> {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(json);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  private async drain(): Promise<void> {
    this.draining = true;
    while (this.pending) {
      const batch = this.pending;
      this.pending = undefined;
      try {
        await mkdir(path.join(this.directory, 'tasks'), { recursive: true, mode: 0o700 });
        for (const [id, json] of batch.tasks) await this.writeAtomic(this.taskPath(id), json);
        // On migration, publish the index last and retain tasks.json. An interrupted
        // migration still reads the intact legacy snapshot. At every startup the
        // manager closes gates and settles active tasks before accepting requests.
        await this.writeAtomic(path.join(this.directory, 'index.json'), batch.index);
        this.partitioned = true;
        batch.waiters.forEach(({ resolve }) => resolve());
      } catch (error) {
        batch.waiters.forEach(({ reject }) => reject(error));
      }
    }
    this.draining = false;
  }
}
