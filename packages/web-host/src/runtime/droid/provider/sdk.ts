import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createSession,
  resumeSession,
  listModels,
  AutonomyLevel,
  DroidInteractionMode,
  type ReasoningEffort,
  ToolConfirmationOutcome,
  type DroidSession,
  type DroidStreamEvent,
  type ModelInfo,
  type ResumeSessionOptions,
} from '@factory/droid-sdk/node';
import { type Specialist, type StoredTask } from '../types.js';
import { environment, type DroidEnvironment } from './environment.js';
import { DroidTransport } from './transport.js';
import { BUILTIN_TOOL_IDS } from './isolation.js';
import { SYSTEM_PROMPTS } from './prompts.js';
import { DroidExecutable } from '../runtime/executable.js';
import { SpecialistSettingsStore, LEGACY_EFFORTS } from './settings.js';
import { valid } from 'semver';
import {
  isModelSelectionAvailable,
  type CliModelCatalog,
} from '../../../../../desktop/src/common/types/platform/cliModels.js';

const execute = promisify(execFile);
export type SpecialistSession = {
  id: string;
  disabledToolIds: string[];
  stream: (prompt: string) => AsyncIterable<DroidStreamEvent>;
  close: () => Promise<void>;
};
export type SpecialistProvider = { open: (task: StoredTask, signal: AbortSignal) => Promise<SpecialistSession> };
/** Official SDK adapter; only this layer knows Factory protocol and model metadata. */
export class FactoryProvider implements SpecialistProvider {
  readonly command: string;
  readonly runtime: DroidExecutable;
  readonly preferences: SpecialistSettingsStore;
  private versionCache?: { command: string; promise: Promise<string> };
  private readonly catalogs = new Map<string, { version: string; expires: number; promise: Promise<ModelInfo[]> }>();
  constructor(
    readonly dataDir: string,
    command?: string
  ) {
    this.command = command || process.env.AIONUI_DROID_BIN || process.env.AIONUI_BUNDLED_DROID || 'droid';
    this.runtime = new DroidExecutable(dataDir, command || process.env.AIONUI_DROID_BIN);
    this.preferences = new SpecialistSettingsStore(dataDir);
  }

  executable(): Promise<string> {
    return this.runtime.resolve();
  }
  invalidate(userId?: string): void {
    if (userId) this.catalogs.delete(userId);
    else {
      this.catalogs.clear();
      this.versionCache = undefined;
    }
  }

  async version(): Promise<string> {
    const command = await this.executable();
    if (this.versionCache?.command === command) return this.versionCache.promise;
    const promise = environment(this.dataDir, '_version')
      .then((context) =>
        execute(command, ['--version'], {
          ...context,
          timeout: 10000,
          maxBuffer: 16384,
          windowsHide: true,
        })
      )
      .then(({ stdout }) => {
        const value = stdout.trim();
        if (!valid(value)) throw new Error('SPECIALIST_CLI_VERSION_UNSUPPORTED');
        return value;
      })
      .catch((error: unknown) => {
        if (this.versionCache?.command === command) this.versionCache = undefined;
        throw error;
      });
    this.versionCache = { command, promise };
    return promise;
  }

  async transport(
    context: DroidEnvironment,
    mode: 'acp' | 'stream-jsonrpc' = 'stream-jsonrpc',
    command?: string
  ): Promise<DroidTransport> {
    await this.version();
    return DroidTransport.start(
      command ?? (await this.executable()),
      ['exec', '--output-format', mode, ...(mode === 'stream-jsonrpc' ? ['--input-format', 'stream-jsonrpc'] : [])],
      context
    );
  }

  async catalog(userId: string, refresh = false): Promise<ModelInfo[]> {
    const version = await this.version();
    const cached = this.catalogs.get(userId);
    if (!refresh && cached && cached.version === version && cached.expires > Date.now()) return cached.promise;
    const promise = (async () => {
      const context = await environment(this.dataDir, userId);
      const transport = await this.transport(context);
      const timeout = setTimeout(() => {
        void transport.close();
      }, 20000);
      try {
        return await listModels({ transport, includeDisabled: true });
      } finally {
        clearTimeout(timeout);
        await transport.close();
      }
    })();
    this.catalogs.set(userId, { version, expires: Date.now() + 60000, promise });
    void promise.catch(() => {
      if (this.catalogs.get(userId)?.promise === promise) this.catalogs.delete(userId);
    });
    return promise;
  }

  async models(userId: string, refresh = false): Promise<CliModelCatalog> {
    const models = await this.catalog(userId, refresh);
    return {
      version: await this.version(),
      fetchedAt: new Date().toISOString(),
      models: models.map((model) =>
        Object.assign(
          {
            id: model.id,
            displayName: model.displayName || model.id,
            supportedReasoningEfforts: model.supportedReasoningEfforts ?? [],
            defaultReasoningEffort: model.supportedReasoningEfforts?.length ? model.defaultReasoningEffort : null,
            disabled: Boolean(model.disabled || model.disabledReason),
          },
          model.disabledReason ? { disabledReason: model.disabledReason } : {}
        )
      ),
    };
  }

  async availableModels(userId: string): Promise<Record<Specialist, boolean>> {
    const [catalog, settings] = await Promise.all([this.models(userId), this.preferences.get(userId)]);
    const available = (specialist: Specialist): boolean =>
      isModelSelectionAvailable(settings[specialist], catalog.models);
    return { argon: available('argon'), opus: available('opus') };
  }

  async open(task: StoredTask, signal: AbortSignal): Promise<SpecialistSession> {
    const command = await this.executable();
    const catalog = await this.models(task.userId);
    signal.throwIfAborted();
    const effort = task.reasoningEffort === undefined ? LEGACY_EFFORTS[task.specialist] : task.reasoningEffort;
    if (!isModelSelectionAvailable({ model: task.model, reasoningEffort: effort }, catalog.models))
      throw new Error('SPECIALIST_MODEL_UNAVAILABLE');
    const context = await environment(this.dataDir, task.userId, task.id);
    signal.throwIfAborted();
    const transport = await this.transport(context, 'stream-jsonrpc', command);
    const abort = (): void => {
      void transport.close();
    };
    signal.addEventListener('abort', abort, { once: true });
    let session: DroidSession | undefined;
    const close = async (): Promise<void> => {
      signal.removeEventListener('abort', abort);
      // Closing the transport also unblocks pending SDK calls; no close/send race can hang shutdown.
      await transport.close();
      await session?.close().catch(() => {});
    };
    try {
      signal.throwIfAborted();
      const runtime: ResumeSessionOptions = {
        transport,
        abortSignal: signal,
        mcpServers: [],
        disableBuiltinSkills: true,
        autoRejectPermissionRequests: true,
        disabledToolIds: [...new Set([...BUILTIN_TOOL_IDS, ...task.disabledToolIds])],
        permissionHandler: () => ToolConfirmationOutcome.Cancel,
        askUserHandler: () => ({ cancelled: true, answers: [] }),
      };
      session = task.sessionId
        ? await resumeSession(task.sessionId, runtime)
        : await createSession({
            ...runtime,
            cwd: context.cwd,
            modelId: task.model,
            ...(effort === null ? {} : { reasoningEffort: effort as ReasoningEffort }),
            interactionMode: DroidInteractionMode.Auto,
            autonomyLevel: AutonomyLevel.Off,
            systemPrompt: SYSTEM_PROMPTS[task.specialist],
          });
      signal.throwIfAborted();
      await session.updateSettings({
        modelId: task.model,
        ...(effort === null ? {} : { reasoningEffort: effort as ReasoningEffort }),
        interactionMode: DroidInteractionMode.Auto,
        autonomyLevel: AutonomyLevel.Off,
      });
      signal.throwIfAborted();
      const tools = await session.listTools({ modelId: task.model });
      signal.throwIfAborted();
      const disabledToolIds = [
        ...new Set([...BUILTIN_TOOL_IDS, ...task.disabledToolIds, ...tools.map((tool) => tool.id)]),
      ].toSorted();
      if (!disabledToolIds.length) throw new Error('SPECIALIST_TOOLS_NOT_ISOLATED');
      await session.updateSettings({ disabledToolIds });
      signal.throwIfAborted();
      const effectiveTools = await session.listTools({ modelId: task.model });
      signal.throwIfAborted();
      const settings = session.settings;
      if (settings.modelId !== task.model || (effort !== null && settings.reasoningEffort !== effort))
        throw new Error('SPECIALIST_MODEL_UNAVAILABLE');
      if (
        JSON.stringify([...(settings.disabledToolIds ?? [])].toSorted()) !== JSON.stringify(disabledToolIds) ||
        effectiveTools.some((tool) => !disabledToolIds.includes(tool.id) || tool.allowed)
      )
        throw new Error('SPECIALIST_TOOLS_NOT_ISOLATED');
      const native = session;
      return {
        id: session.id,
        disabledToolIds,
        stream: (prompt) => native.stream(prompt, { includePartialMessages: true }),
        close,
      };
    } catch (error) {
      await close();
      throw error;
    }
  }
}
