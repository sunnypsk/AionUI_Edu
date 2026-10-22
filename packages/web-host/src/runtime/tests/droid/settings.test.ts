import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { SpecialistSettingsStore, defaultSettings } from '../../droid/provider/settings.js';
import { SpecialistManager } from '../../droid/manager.js';
import type { StoredTask } from '../../droid/types.js';
import type { CliModel } from '../../../../../desktop/src/common/types/platform/cliModels.js';

const models: CliModel[] = [
  {
    id: 'new/model',
    displayName: 'New',
    supportedReasoningEfforts: ['dynamic', 'max'],
    defaultReasoningEffort: 'dynamic',
    disabled: false,
  },
  { id: 'simple', displayName: 'Simple', supportedReasoningEfforts: [], defaultReasoningEffort: null, disabled: false },
];
const settings = {
  argon: { model: 'new/model', reasoningEffort: 'dynamic' },
  opus: { model: 'simple', reasoningEffort: null },
};
describe('specialist preferences and task snapshots', () => {
  let directory: string;
  let store: SpecialistSettingsStore;
  let manager: SpecialistManager | undefined;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'droid-settings-'));
    store = new SpecialistSettingsStore(directory);
  });
  afterEach(async () => {
    await manager?.close();
    manager = undefined;
    await rm(directory, { recursive: true, force: true });
  });
  it('persists both roles across reloads without leaking another user preferences', async () => {
    await store.save('one', settings, models);
    expect(await new SpecialistSettingsStore(directory).get('one')).toEqual(settings);
    expect(await store.get('two')).toEqual(defaultSettings());
  });
  it('rejects unsupported or disabled selections without replacing saved settings', async () => {
    await store.save('one', settings, models);
    await expect(
      store.save('one', { ...settings, argon: { model: 'new/model', reasoningEffort: 'low' } }, models)
    ).rejects.toThrow('SPECIALIST_MODEL_UNAVAILABLE');
    await expect(
      store.save(
        'one',
        settings,
        models.map((m) => ({ ...m, disabled: true }))
      )
    ).rejects.toThrow('SPECIALIST_MODEL_UNAVAILABLE');
    expect(await store.get('one')).toEqual(settings);
  });
  it('does not overwrite malformed storage or accept a missing reasoning field', async () => {
    await store.save('one', settings, models);
    await expect(store.save('one', { ...settings, argon: { model: 'new/model' } }, models)).rejects.toThrow();
    await writeFile(path.join(directory, 'droid/users/one/preferences.json'), 'broken');
    await expect(store.get('one')).rejects.toThrow('SPECIALIST_SETTINGS_INVALID');
  });
  it('keeps revisions on the original selection while new tasks use updated preferences', async () => {
    const opened: StoredTask[] = [];
    manager = new SpecialistManager(directory, {
      open: async (task) => {
        opened.push(structuredClone(task));
        return {
          id: task.sessionId || task.id,
          disabledToolIds: [],
          close: async () => {},
          stream: async function* () {
            yield {
              type: 'result',
              subtype: 'success',
              success: true,
              interrupted: false,
              error: null,
              text: 'draft',
              sessionId: task.id,
              durationMs: 1,
              tokenUsage: null,
              messages: [],
              turnCount: 1,
            };
          },
        };
      },
    });
    const owner = { userId: 'one', conversationId: 'lesson', workspace: directory };
    await store.save('one', settings, models);
    await manager.parentStart(owner, 'event', 'thread');
    const task = await manager.start(owner, 'argon', 'draft');
    await manager.wait(owner, [task.id], 5);
    await store.save('one', { ...settings, argon: settings.opus }, models);
    // A terminal status can precede async transport cleanup.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await manager.reply(owner, task.id, 'revise');
    await manager.wait(owner, [task.id], 5);
    const next = await manager.start(owner, 'argon', 'new');
    expect(opened.slice(0, 2).map((item) => [item.model, item.reasoningEffort])).toEqual([
      ['new/model', 'dynamic'],
      ['new/model', 'dynamic'],
    ]);
    expect(next).toMatchObject({ model: 'simple', reasoningEffort: null });
  });
});
