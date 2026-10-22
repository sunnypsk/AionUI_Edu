import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { State } from './types.js';

/** Serialize atomic snapshots; a failed write never replaces the last good state. */
export class SpecialistStore {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string) {}

  async load(): Promise<State> {
    try {
      const value = JSON.parse(await readFile(path.join(this.directory, 'tasks.json'), 'utf8')) as State;
      if (value.version !== 1 || !Array.isArray(value.tasks) || !value.gates || typeof value.gates !== 'object')
        throw new Error('SPECIALIST_STORE_INVALID');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, tasks: [], gates: {} };
      throw new Error('SPECIALIST_STORE_INVALID');
    }
  }

  save(state: State): Promise<void> {
    const json = JSON.stringify(state);
    const write = this.writes
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const target = path.join(this.directory, 'tasks.json');
        const temporary = `${target}.${randomUUID()}.tmp`;
        const file = await open(temporary, 'wx', 0o600);
        try {
          await file.writeFile(json);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, target);
      });
    this.writes = write;
    return write;
  }
}
