import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  ownerId,
  settingsSchema,
  type AudioSettings,
  type AudioSettingsInput,
  type StoredAudioTask,
} from './types.js';

/** Private host-owned settings and task records; credentials never enter task snapshots. */
export class AudioStore {
  private writes = new Map<string, Promise<void>>();
  constructor(readonly dataDir: string) {}
  private user(userId: string): string {
    return path.join(this.dataDir, 'audio', 'users', ownerId.parse(userId));
  }
  private async atomic(file: string, value: unknown | (() => Promise<unknown>)): Promise<void> {
    const pending = (this.writes.get(file) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(typeof value === 'function' ? await value() : value), {
          mode: 0o600,
          flag: 'wx',
        });
        await rename(temporary, file);
      });
    this.writes.set(file, pending);
    try {
      await pending;
    } finally {
      if (this.writes.get(file) === pending) this.writes.delete(file);
    }
  }
  async selection(userId: string): Promise<{ model: string; apiKey?: string }> {
    const file = path.join(this.user(userId), 'settings.json');
    await this.writes.get(file);
    return this.readSelection(file);
  }
  private async readSelection(file: string): Promise<{ model: string; apiKey?: string }> {
    try {
      return settingsSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { model: DEFAULT_TRANSCRIPTION_MODEL };
      throw new Error('AUDIO_SETTINGS_INVALID', { cause: error });
    }
  }
  async settings(userId: string): Promise<AudioSettings> {
    const selection = await this.selection(userId);
    return { model: selection.model, hasApiKey: !!selection.apiKey };
  }
  async saveSettings(userId: string, input: AudioSettingsInput): Promise<AudioSettings> {
    const value = settingsSchema.parse(input);
    if (value.clearApiKey && value.apiKey) throw new Error('INVALID_REQUEST');
    const file = path.join(this.user(userId), 'settings.json');
    await this.atomic(file, async () => {
      const previous = await this.readSelection(file);
      return {
        model: value.model,
        ...(!value.clearApiKey && (value.apiKey ?? previous.apiKey) ? { apiKey: value.apiKey ?? previous.apiKey } : {}),
      };
    });
    return this.settings(userId);
  }
  async saveTask(task: StoredAudioTask): Promise<void> {
    await this.atomic(path.join(this.user(task.owner.userId), 'tasks', `${task.id}.json`), task);
  }
  async loadTasks(): Promise<StoredAudioTask[]> {
    const root = path.join(this.dataDir, 'audio', 'users');
    const tasks: StoredAudioTask[] = [];
    let users;
    try {
      users = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return tasks;
      throw error;
    }
    for (const user of users.filter((entry) => entry.isDirectory() && ownerId.safeParse(entry.name).success)) {
      let files: string[];
      try {
        files = await readdir(path.join(root, user.name, 'tasks'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for (const file of files.filter((name) => /^[a-f\d-]{36}\.json$/.test(name))) {
        const task = JSON.parse(await readFile(path.join(root, user.name, 'tasks', file), 'utf8')) as StoredAudioTask;
        if (
          task.owner?.userId !== user.name ||
          `${task.id}.json` !== file ||
          !ownerId.safeParse(task.owner.conversationId).success
        )
          throw new Error('AUDIO_STATE_INVALID');
        tasks.push(task);
      }
    }
    return tasks;
  }
}
