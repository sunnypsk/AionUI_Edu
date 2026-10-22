import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createSession,
  resumeSession,
  listModels,
  AutonomyLevel,
  DroidInteractionMode,
  ReasoningEffort,
  ToolConfirmationOutcome,
  type DroidSession,
  type DroidStreamEvent,
  type ModelInfo,
  type ResumeSessionOptions,
} from '@factory/droid-sdk/node';
import { DROID_VERSION, MODELS, type Specialist, type StoredTask } from '../types.js';
import { environment, type DroidEnvironment } from './environment.js';
import { DroidTransport } from './transport.js';
import { BUILTIN_TOOL_IDS } from './isolation.js';
import { SYSTEM_PROMPTS } from './prompts.js';

const execute = promisify(execFile);
export type SpecialistSession = {
  id: string;
  disabledToolIds: string[];
  stream: (prompt: string) => AsyncIterable<DroidStreamEvent>;
  close: () => Promise<void>;
};
export type SpecialistProvider = { open: (task: StoredTask, signal: AbortSignal) => Promise<SpecialistSession> };
/** Writing needs little reasoning; lesson and curriculum design benefits from more. */
export const EFFORTS: Record<Specialist, ReasoningEffort> = {
  argon: ReasoningEffort.Low,
  opus: ReasoningEffort.Medium,
};

/** Official SDK adapter; only this layer knows Factory protocol and model metadata. */
export class FactoryProvider implements SpecialistProvider {
  readonly command: string;
  private versionPromise?: Promise<string>;
  private readonly catalogs = new Map<string, { expires: number; promise: Promise<ModelInfo[]> }>();
  constructor(
    readonly dataDir: string,
    command = process.env.AIONUI_DROID_BIN || 'droid'
  ) {
    this.command = command;
  }

  async version(): Promise<string> {
    this.versionPromise ??= environment(this.dataDir, '_version')
      .then((context) =>
        execute(this.command, ['--version'], {
          ...context,
          timeout: 10000,
          maxBuffer: 16384,
          windowsHide: true,
        })
      )
      .then(({ stdout }) => {
        const value = stdout.trim();
        if (value !== DROID_VERSION) throw new Error('SPECIALIST_CLI_VERSION_UNSUPPORTED');
        return value;
      })
      .catch((error: unknown) => {
        this.versionPromise = undefined;
        throw error;
      });
    return this.versionPromise;
  }

  async transport(
    context: DroidEnvironment,
    mode: 'acp' | 'stream-jsonrpc' = 'stream-jsonrpc'
  ): Promise<DroidTransport> {
    await this.version();
    return DroidTransport.start(
      this.command,
      ['exec', '--output-format', mode, ...(mode === 'stream-jsonrpc' ? ['--input-format', 'stream-jsonrpc'] : [])],
      context
    );
  }

  async catalog(userId: string, refresh = false): Promise<ModelInfo[]> {
    const cached = this.catalogs.get(userId);
    if (!refresh && cached && cached.expires > Date.now()) return cached.promise;
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
    this.catalogs.set(userId, { expires: Date.now() + 60000, promise });
    void promise.catch(() => this.catalogs.delete(userId));
    return promise;
  }

  async availableModels(userId: string): Promise<Record<Specialist, boolean>> {
    const models = await this.catalog(userId);
    const available = (specialist: Specialist): boolean =>
      models.some(
        (model) =>
          model.id === MODELS[specialist] &&
          !model.disabledReason &&
          model.supportedReasoningEfforts?.includes(EFFORTS[specialist])
      );
    return { argon: available('argon'), opus: available('opus') };
  }

  async open(task: StoredTask, signal: AbortSignal): Promise<SpecialistSession> {
    const models = await this.availableModels(task.userId);
    signal.throwIfAborted();
    if (!models[task.specialist]) throw new Error('SPECIALIST_MODEL_UNAVAILABLE');
    const effort = EFFORTS[task.specialist];
    const context = await environment(this.dataDir, task.userId, task.id);
    signal.throwIfAborted();
    const transport = await this.transport(context);
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
            reasoningEffort: effort,
            interactionMode: DroidInteractionMode.Auto,
            autonomyLevel: AutonomyLevel.Off,
            systemPrompt: SYSTEM_PROMPTS[task.specialist],
          });
      signal.throwIfAborted();
      await session.updateSettings({
        modelId: task.model,
        reasoningEffort: effort,
        interactionMode: DroidInteractionMode.Auto,
        autonomyLevel: AutonomyLevel.Off,
      });
      signal.throwIfAborted();
      const tools = await session.listTools({ modelId: task.model });
      signal.throwIfAborted();
      const disabledToolIds = [
        ...new Set([...BUILTIN_TOOL_IDS, ...task.disabledToolIds, ...tools.map((tool) => tool.id)]),
      ].sort();
      if (!disabledToolIds.length) throw new Error('SPECIALIST_TOOLS_NOT_ISOLATED');
      await session.updateSettings({ disabledToolIds });
      signal.throwIfAborted();
      const effectiveTools = await session.listTools({ modelId: task.model });
      signal.throwIfAborted();
      const settings = session.settings;
      if (settings.modelId !== task.model || settings.reasoningEffort !== effort)
        throw new Error('SPECIALIST_MODEL_UNAVAILABLE');
      if (
        JSON.stringify([...(settings.disabledToolIds ?? [])].sort()) !== JSON.stringify(disabledToolIds) ||
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
