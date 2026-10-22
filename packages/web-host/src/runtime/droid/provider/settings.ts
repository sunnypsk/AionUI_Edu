import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { idSchema, MODELS } from '../types.js';
import {
  isModelSelectionAvailable,
  type CliModel,
} from '../../../../../desktop/src/common/types/platform/cliModels.js';
import type { SpecialistSettings } from '../../../../../desktop/src/common/types/platform/specialists.js';

// Migration defaults only. Selectable capabilities always come from the CLI catalog.
export const LEGACY_EFFORTS = { argon: 'low', opus: 'medium' } as const;
export const defaultSettings = (): SpecialistSettings => ({
  argon: { model: MODELS.argon, reasoningEffort: LEGACY_EFFORTS.argon },
  opus: { model: MODELS.opus, reasoningEffort: LEGACY_EFFORTS.opus },
});
const selection = z
  .object({ model: z.string().trim().min(1).max(512), reasoningEffort: z.string().trim().min(1).max(128).nullable() })
  .strict();
export const settingsSchema = z.object({ argon: selection, opus: selection }).strict();

/** Owner-scoped preferences are separate from Factory's CLI configuration and credentials. */
export class SpecialistSettingsStore {
  private writes = new Map<string, Promise<void>>();
  constructor(private readonly dataDir: string) {}
  private file(userId: string): string {
    return path.join(this.dataDir, 'droid', 'users', idSchema.parse(userId), 'preferences.json');
  }
  async get(userId: string): Promise<SpecialistSettings> {
    await this.writes.get(userId)?.catch(() => {});
    try {
      return settingsSchema.parse(JSON.parse(await readFile(this.file(userId), 'utf8'))) as SpecialistSettings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings();
      throw new Error('SPECIALIST_SETTINGS_INVALID', { cause: error });
    }
  }
  async save(userId: string, input: unknown, models: CliModel[]): Promise<SpecialistSettings> {
    const value = settingsSchema.parse(input) as SpecialistSettings;
    if (!Object.values(value).every((item) => isModelSelectionAvailable(item, models)))
      throw new Error('SPECIALIST_MODEL_UNAVAILABLE');
    const target = this.file(userId);
    const write = (this.writes.get(userId) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const temporary = `${target}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
        await rename(temporary, target);
      });
    this.writes.set(userId, write);
    try {
      await write;
      return value;
    } finally {
      if (this.writes.get(userId) === write) this.writes.delete(userId);
    }
  }
}
