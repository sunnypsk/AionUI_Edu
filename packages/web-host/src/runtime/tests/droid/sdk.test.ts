import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FactoryProvider } from '../../droid/provider/sdk.js';
import { SYSTEM_PROMPTS } from '../../droid/provider/prompts.js';
import { MODELS, type StoredTask } from '../../droid/types.js';
import type { DroidTransport } from '../../droid/provider/transport.js';

const mocked = vi.hoisted(() => ({ createSession: vi.fn(), resumeSession: vi.fn(), listModels: vi.fn() }));
vi.mock('@factory/droid-sdk/node', async () => ({ ...(await vi.importActual('@factory/droid-sdk/node')), ...mocked }));
describe('verified SDK isolation', () => {
  let directory: string;
  let provider: FactoryProvider;
  let task: StoredTask;
  let leak: boolean;
  let corrupt: boolean;
  beforeEach(async () => {
    vi.clearAllMocks();
    leak = false;
    corrupt = false;
    directory = await mkdtemp(path.join(os.tmpdir(), 'aion-sdk-'));
    provider = new FactoryProvider(directory);
    vi.spyOn(provider, 'version').mockResolvedValue('0.245.1');
    vi.spyOn(provider, 'transport').mockResolvedValue({ close: async () => {} } as unknown as DroidTransport);
    mocked.listModels.mockResolvedValue(
      Object.values(MODELS).map((id) => ({
        id,
        supportedReasoningEfforts: ['low', 'medium'],
        disabledReason: undefined,
      }))
    );
    const native = (options: { modelId?: string; reasoningEffort?: string; disabledToolIds: string[] }) => {
      const settings = {
        modelId: options.modelId ?? MODELS.argon,
        reasoningEffort: options.reasoningEffort ?? 'low',
        disabledToolIds: options.disabledToolIds,
      };
      return {
        id: 'native-session',
        settings,
        updateSettings: async (value: Record<string, unknown>) => {
          Object.assign(settings, value);
          if (corrupt && value.disabledToolIds) settings.disabledToolIds = [];
        },
        listTools: async () => [
          { id: 'Read', allowed: false },
          { id: 'ToolSearch', allowed: leak || !settings.disabledToolIds.includes('list-computers-cli') },
        ],
        close: async () => {},
        stream: vi.fn(),
      };
    };
    mocked.createSession.mockImplementation(async (options) => native(options));
    mocked.resumeSession.mockImplementation(async (_id, options) => native(options));
    task = {
      id: 'fixture',
      userId: 'teacher',
      conversationId: 'lesson',
      specialist: 'argon',
      model: MODELS.argon,
      epoch: 1,
      createdAt: 1,
      disabledToolIds: [],
      runs: [],
    };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  it('includes hidden deferred tools before creation and confirms model and low effort', async () => {
    const session = await provider.open(task, new AbortController().signal);
    expect(mocked.createSession.mock.calls[0][0]).toMatchObject({
      modelId: MODELS.argon,
      reasoningEffort: 'low',
      systemPrompt: SYSTEM_PROMPTS.argon,
      disableBuiltinSkills: true,
      autoRejectPermissionRequests: true,
    });
    expect(session.disabledToolIds).toContain('list-computers-cli');
    await session.close();
  });
  it('creates the teaching designer with medium effort and its own prompt', async () => {
    Object.assign(task, { specialist: 'opus', model: MODELS.opus });
    const session = await provider.open(task, new AbortController().signal);
    expect(mocked.createSession.mock.calls[0][0]).toMatchObject({
      modelId: MODELS.opus,
      reasoningEffort: 'medium',
      systemPrompt: SYSTEM_PROMPTS.opus,
    });
    expect(SYSTEM_PROMPTS.opus).toContain('teaching designer');
    expect(SYSTEM_PROMPTS.argon).toContain('writer');
    await session.close();
  });
  it('rejects a model that does not offer the required effort', async () => {
    Object.assign(task, { specialist: 'opus', model: MODELS.opus });
    mocked.listModels.mockResolvedValue(
      Object.values(MODELS).map((id) => ({ id, supportedReasoningEfforts: ['low'], disabledReason: undefined }))
    );
    await expect(provider.open(task, new AbortController().signal)).rejects.toThrow('SPECIALIST_MODEL_UNAVAILABLE');
    expect(mocked.createSession).not.toHaveBeenCalled();
  });
  it('passes isolation settings before resuming the exact native session', async () => {
    task.sessionId = 'previous';
    const session = await provider.open(task, new AbortController().signal);
    expect(mocked.resumeSession.mock.calls[0][0]).toBe('previous');
    expect(mocked.resumeSession.mock.calls[0][1].disabledToolIds).toContain('Task');
    await session.close();
  });
  it('refuses newly exposed dynamic tools', async () => {
    leak = true;
    await expect(provider.open(task, new AbortController().signal)).rejects.toThrow('SPECIALIST_TOOLS_NOT_ISOLATED');
  });
  it('does not trust allowed:false without the disabled settings readback', async () => {
    corrupt = true;
    await expect(provider.open(task, new AbortController().signal)).rejects.toThrow('SPECIALIST_TOOLS_NOT_ISOLATED');
  });
  it('does not substitute a missing model', async () => {
    mocked.listModels.mockResolvedValue([]);
    await expect(provider.open(task, new AbortController().signal)).rejects.toThrow('SPECIALIST_MODEL_UNAVAILABLE');
    expect(mocked.createSession).not.toHaveBeenCalled();
  });
  it('uses the task snapshot rather than role defaults for create and resume', async () => {
    Object.assign(task, { model: 'future-model', reasoningEffort: 'max' });
    mocked.listModels.mockResolvedValue([
      {
        id: 'future-model',
        displayName: 'Future',
        supportedReasoningEfforts: ['max'],
        defaultReasoningEffort: 'max',
        disabled: false,
      },
    ]);
    const session = await provider.open(task, new AbortController().signal);
    expect(mocked.createSession.mock.calls[0][0]).toMatchObject({ modelId: 'future-model', reasoningEffort: 'max' });
    await session.close();
    task.sessionId = 'native';
    const resumed = await provider.open(task, new AbortController().signal);
    expect(resumed.id).toBeTruthy();
    await resumed.close();
  });
  it('rejects policy-disabled models even without a disabled reason', async () => {
    mocked.listModels.mockResolvedValue([{ id: task.model, supportedReasoningEfforts: ['low'], disabled: true }]);
    await expect(provider.open(task, new AbortController().signal)).rejects.toThrow('SPECIALIST_MODEL_UNAVAILABLE');
  });
  it('invalidates discovery independently by user and CLI version', async () => {
    await provider.catalog('one');
    await provider.catalog('one');
    await provider.catalog('two');
    expect(mocked.listModels).toHaveBeenCalledTimes(2);
    provider.invalidate('one');
    await provider.catalog('one');
    vi.mocked(provider.version).mockResolvedValue('0.247.0');
    await provider.catalog('two');
    expect(mocked.listModels).toHaveBeenCalledTimes(4);
  });
});
