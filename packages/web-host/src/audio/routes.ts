import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { ListeningState } from '../../../desktop/src/common/types/platform/listeningProject.ts';
import { verifyBrowserCapability } from '../runtime/browser/types.js';
import { AudioManager } from './manager.js';
import { audioCapabilities } from './providers/readiness.js';
import { AUDIO_VOICES } from '../../../desktop/src/common/types/platform/audioTools.ts';
import {
  agentTask,
  audioError,
  ownerId,
  settingsSchema,
  toolSchemas,
  type AudioOwner,
  type AudioToolName,
} from './types.js';
import {
  AudioProjectError,
  PROJECT_SUFFIX,
  readProjectState,
  saveProject,
  setQaAccepted,
  sourcePeaks,
  sourceRange,
} from './track/index.js';
import { workspaceFile } from './providers/media.js';

const listeningTarget = z.object({ conversation_id: z.string(), path: z.string().min(1).max(4096) });
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const send = (res: ServerResponse, status: number, value: unknown): void => {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
};
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of req) {
    const chunk = Buffer.from(value);
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024 + 65536) throw new Error('INVALID_REQUEST');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
  } catch {
    throw new Error('INVALID_REQUEST');
  }
}
function validateWrite(req: IncomingMessage): void {
  if (
    req.headers['sec-fetch-site'] === 'cross-site' ||
    (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) ||
    !req.headers['content-type']?.startsWith('application/json')
  )
    throw new Error('UNAUTHORIZED');
  if (req.headers.cookie) {
    const match = /(?:^|;\s*)aionui-csrf-token=([^;]*)/.exec(req.headers.cookie);
    let cookie = '';
    try {
      cookie = decodeURIComponent(match?.[1] ?? '');
    } catch {
      throw new Error('CSRF_INVALID');
    }
    const header = req.headers['x-csrf-token'];
    if (
      typeof header !== 'string' ||
      !cookie ||
      Buffer.byteLength(cookie) !== Buffer.byteLength(header) ||
      !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))
    )
      throw new Error('CSRF_INVALID');
  }
}

/** Cookie-authenticated settings and a private owner-capability MCP gateway. */
export async function createAudioRuntime(options: { dataDir: string; manager?: AudioManager }) {
  const manager = options.manager ?? new AudioManager(options.dataDir);
  await manager.ready;
  const key = randomBytes(32).toString('hex');
  let backendPort = 0;
  const observations = new WeakMap<IncomingMessage, { conversationId: string; epoch: number; deleted: boolean }>();
  const backend = async (route: string, headers: Record<string, string>): Promise<Record<string, unknown>> => {
    if (!backendPort) throw new Error('AUDIO_UNAVAILABLE');
    const response = await fetch(`http://127.0.0.1:${backendPort}${route}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('UNAUTHORIZED');
    }
    const result = record(await response.json());
    return Array.isArray(result.data) ? { items: result.data } : result.data ? record(result.data) : result;
  };
  const owner = async (
    userId: string,
    conversationId: string,
    headers: Record<string, string>
  ): Promise<AudioOwner> => {
    ownerId.parse(userId);
    const identity = await backend('/api/system/current-user', headers);
    if (identity.id !== userId) throw new Error('UNAUTHORIZED');
    return conversationOwner(userId, conversationId, headers);
  };
  /** Core only returns conversations visible to the authenticated caller, so this also checks ownership. */
  const conversationOwner = async (
    userId: string,
    conversationId: string,
    headers: Record<string, string>
  ): Promise<AudioOwner> => {
    ownerId.parse(conversationId);
    const conversation = await backend(`/api/conversations/${encodeURIComponent(conversationId)}`, headers);
    const workspace = record(conversation.extra).workspace;
    if (conversation.id !== conversationId || typeof workspace !== 'string' || !path.isAbsolute(workspace))
      throw new Error('AUDIO_FILE_FORBIDDEN');
    return { userId, conversationId, workspace };
  };
  /** Teacher-facing listening editor API; every response carries the refreshed project state. */
  const listening = async (
    req: IncomingMessage,
    url: URL,
    userId: string,
    headers: Record<string, string>
  ): Promise<ListeningState | { taskId: string; state: ListeningState }> => {
    const route = url.pathname.slice('/api/edu/audio/listening'.length);
    const input = req.method === 'GET' ? Object.fromEntries(url.searchParams) : record(await body(req));
    const target = listeningTarget.parse({ conversation_id: input.conversation_id, path: input.path });
    const context = await conversationOwner(userId, target.conversation_id, headers);
    const state = async (): Promise<ListeningState> => {
      const current = await readProjectState(context.workspace, target.path);
      const segments = current.project?.sections.flatMap((section) => section.segments) ?? [];
      const tasks = (await manager.listTracks(context, target.path)).map(agentTask).map((task) => {
        if (task.kind !== 'analysis' || !task.issues?.length) return task;
        const source = task.files.find((file) => file.format !== 'json')?.path;
        return {
          ...task,
          issues: task.issues.map((issue) => ({
            ...issue,
            // Applying a replacement creates new ids. Keep diagnostics linked to the current source ranges.
            segmentId: segments.find((segment) => {
              const range =
                segment.type === 'clip' ? segment : segment.type === 'speech' ? segment.replaces : undefined;
              return range && range.path === source && range.start < issue.endSecond && range.end > issue.startSecond;
            })?.id,
          })),
        };
      });
      return { ...current, tasks };
    };
    if (route === '/replacements/preview' && req.method === 'POST') {
      const value = z
        .object({
          revision: z.string().max(64),
          clipId: z.string().max(64),
          start: z.number().finite().min(0),
          end: z.number().finite().positive(),
          text: z.string().trim().min(1).max(2000),
          voice: z.enum(AUDIO_VOICES),
        })
        .parse(input);
      const task = await manager.startEditorTask(context, 'replacement', {
        project_path: target.path,
        revision: value.revision,
        replacement: value,
      });
      return { taskId: task.id, state: await state() };
    }
    if (route === '/segments/generate' && req.method === 'POST') {
      const value = z
        .object({
          revision: z.string().max(64),
          segment_ids: z
            .array(z.string().regex(/^[\w-]{1,64}$/))
            .min(1)
            .max(500),
        })
        .parse(input);
      const task = await manager.startEditorTask(context, 'segments', {
        project_path: target.path,
        revision: value.revision,
        segmentIds: value.segment_ids,
      });
      return { taskId: task.id, state: await state() };
    }
    if (route === '/bundle' && req.method === 'POST') {
      const { revision } = z.object({ revision: z.string().max(64) }).parse(input);
      const task = await manager.startEditorTask(context, 'export', { project_path: target.path, revision });
      return { taskId: task.id, state: await state() };
    }
    if (route === '/replacements/apply' && req.method === 'POST') {
      const value = z.object({ revision: z.string().max(64), previewId: z.string().uuid() }).parse(input);
      await manager.applyReplacement(context, target.path, value.revision, value.previewId);
      return state();
    }
    if (route === '' && req.method === 'PUT') {
      const p = z.object({ project: z.unknown(), revision: z.string().max(64) }).parse(input);
      await saveProject(context.workspace, target.path, p.project, p.revision);
    } else if (route === '/render' && req.method === 'POST') {
      const p = z.object({ only_sections: z.array(z.string()).max(100).optional() }).parse(input);
      await manager.startUserTrack(context, { project_path: target.path, only_sections: p.only_sections });
    } else if (route === '/cancel' && req.method === 'POST')
      await manager.cancelTrack(context, z.object({ task_id: z.string().uuid() }).parse(input).task_id);
    else if (route === '/qa' && req.method === 'POST') {
      const p = z.object({ segment_id: z.string().max(64), accepted: z.boolean() }).parse(input);
      await setQaAccepted(context.workspace, target.path, p.segment_id, p.accepted);
    } else if (route !== '' || req.method !== 'GET') throw new Error('INVALID_REQUEST');
    return state();
  };
  /** Binary preview media for the editor: waveform peaks and short decoded windows of a project's recordings. */
  const listeningMedia = async (
    res: ServerResponse,
    url: URL,
    userId: string,
    headers: Record<string, string>
  ): Promise<void> => {
    const input = z
      .object({ conversation_id: z.string(), path: z.string().min(1).max(4096), source: z.string().min(1).max(4096) })
      .parse(Object.fromEntries(url.searchParams));
    const context = await conversationOwner(userId, input.conversation_id, headers);
    if (!input.path.endsWith(PROJECT_SUFFIX)) throw new Error('AUDIO_FILE_FORBIDDEN');
    await workspaceFile(context.workspace, input.path);
    const abort = new AbortController();
    res.once('close', () => abort.abort());
    let bytes: Buffer;
    let type: string;
    if (url.pathname.endsWith('/peaks')) {
      bytes = await sourcePeaks(context.workspace, input.source, manager.previewMedia, abort.signal);
      type = 'application/octet-stream';
    } else {
      const window = z
        .object({ start: z.coerce.number().finite(), end: z.coerce.number().finite() })
        .parse(Object.fromEntries(url.searchParams));
      bytes = await sourceRange(
        context.workspace,
        input.source,
        window.start,
        window.end,
        manager.previewMedia,
        abort.signal
      );
      type = 'audio/wav';
    }
    if (res.destroyed || res.headersSent) return;
    res.writeHead(200, {
      'content-type': type,
      'content-length': bytes.length,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    res.end(bytes);
  };
  const failure = (res: ServerResponse, error: unknown): void => {
    const code = error instanceof z.ZodError ? 'INVALID_REQUEST' : audioError(error);
    send(
      res,
      code === 'UNAUTHORIZED'
        ? 401
        : code === 'CSRF_INVALID' || code === 'AUDIO_FILE_FORBIDDEN'
          ? 403
          : code === 'INVALID_REQUEST'
            ? 400
            : 409,
      { error: { code, ...(error instanceof AudioProjectError ? { details: error.details } : {}) } }
    );
  };
  const server = http.createServer((req, res) => {
    void (async () => {
      const abort = new AbortController();
      res.once('close', () => abort.abort());
      try {
        if (
          req.method !== 'POST' ||
          !['/command', '/lifecycle'].includes(req.url ?? '') ||
          req.headers.origin ||
          req.headers['sec-fetch-site']
        )
          throw new Error('UNAUTHORIZED');
        const capability = req.headers['x-aionui-audio-capability'];
        const token = req.headers['x-aionui-runtime-token'];
        if (typeof capability !== 'string' || typeof token !== 'string') throw new Error('UNAUTHORIZED');
        const claims = verifyBrowserCapability(key, capability);
        const context = await owner(claims.userId, claims.conversationId, {
          'x-aionui-runtime-token': token,
          'x-aionui-user-id': claims.userId,
          'x-aionui-conversation-id': claims.conversationId,
        });
        const input = await body(req);
        if (req.url === '/lifecycle') {
          const p = z
            .object({
              event: z.enum(['start', 'bound', 'stop']),
              event_id: z.string().max(256).optional(),
              thread_id: z.string().max(256),
              turn_id: z.string().max(256).optional(),
            })
            .strict()
            .parse(input);
          if (p.event === 'start' && p.event_id) await manager.parentStart(context, p.event_id, p.thread_id);
          else if (p.event === 'bound' && p.event_id && p.turn_id)
            await manager.parentBound(context, p.event_id, p.turn_id);
          else if (p.event === 'stop' && p.turn_id) await manager.parentStop(context, p.thread_id, p.turn_id);
          else throw new Error('INVALID_REQUEST');
          send(res, 200, { data: { ok: true } });
        } else {
          const p = z
            .object({
              name: z.enum(Object.keys(toolSchemas) as [AudioToolName, ...AudioToolName[]]),
              arguments: z.unknown(),
            })
            .strict()
            .parse(input);
          send(res, 200, {
            data: agentTask(await manager.command(context, p.name as AudioToolName, p.arguments, abort.signal)),
          });
        }
      } catch (error) {
        failure(res, error);
      }
    })();
  });
  server.requestTimeout = 60000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    env: {
      AIONUI_AUDIO_GATEWAY: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      AIONUI_AUDIO_SIGNING_KEY: key,
    },
    setBackendPort(port: number): void {
      backendPort = port;
    },
    async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const lifecycle = /^\/api\/conversations\/([\w-]+)(\/cancel)?$/.exec(url.pathname);
      if (lifecycle && ((req.method === 'POST' && lifecycle[2]) || (req.method === 'DELETE' && !lifecycle[2])))
        observations.set(req, {
          conversationId: lifecycle[1],
          epoch: await manager.epoch(lifecycle[1]),
          deleted: req.method === 'DELETE',
        });
      if (!url.pathname.startsWith('/api/edu/audio/')) return false;
      try {
        const headers: Record<string, string> = {};
        if (req.headers.cookie) headers.cookie = req.headers.cookie;
        if (req.headers.authorization) headers.authorization = req.headers.authorization;
        if (!Object.keys(headers).length) throw new Error('UNAUTHORIZED');
        const identity = await backend('/api/auth/user', headers);
        const userId = ownerId.parse(record(identity.user ?? identity).id);
        if (req.method !== 'GET') validateWrite(req);
        if (url.pathname === '/api/edu/audio/capabilities' && req.method === 'GET') {
          const conversation = url.searchParams.get('conversation_id');
          const context = conversation ? await conversationOwner(userId, conversation, headers) : undefined;
          const limits = await backend('/api/fs/upload/limits', headers);
          const maxBytes = z.number().int().positive().parse(limits.maxBytes);
          const capabilities = await audioCapabilities((await manager.store.settings(userId)).hasApiKey, maxBytes);
          if (context) {
            const current = await backend(`/api/conversations/${encodeURIComponent(context.conversationId)}`, headers);
            const extra = record(current.extra);
            const selectedBackend = record(current.assistant).backend ?? extra.backend;
            if (selectedBackend && selectedBackend !== 'codex')
              capabilities.tools = { available: false, reason: 'AUDIO_UNAVAILABLE' };
            else if (extra.agent_id) {
              const management = await backend('/api/agents/management', headers).catch(
                (): Record<string, unknown> => ({ items: [] })
              );
              const entries = Array.isArray(management.items) ? management.items : [];
              const agent = entries.map(record).find((entry) => entry.id === extra.agent_id);
              if (!agent || agent.has_command_override === true)
                capabilities.tools = manager.hasAudioRuntime(context)
                  ? { available: true }
                  : { available: false, reason: 'AUDIO_UNAVAILABLE' };
            }
          }
          send(res, 200, { data: capabilities });
        } else if (url.pathname === '/api/edu/audio/settings' && req.method === 'GET')
          send(res, 200, { data: await manager.store.settings(userId) });
        else if (url.pathname === '/api/edu/audio/settings' && req.method === 'POST') {
          const value = settingsSchema.parse(await body(req));
          const previous = await manager.store.settings(userId);
          if (value.model !== previous.model) await manager.catalog.resolve(value.model);
          send(res, 200, { data: await manager.store.saveSettings(userId, value) });
        } else if (url.pathname === '/api/edu/audio/models' && req.method === 'GET')
          send(res, 200, { data: await manager.catalog.get(url.searchParams.get('refresh') === '1') });
        else if (
          req.method === 'GET' &&
          ['/api/edu/audio/listening/peaks', '/api/edu/audio/listening/range'].includes(url.pathname)
        )
          await listeningMedia(res, url, userId, headers);
        else if (url.pathname.startsWith('/api/edu/audio/listening'))
          send(res, 200, { data: await listening(req, url, userId, headers) });
        else throw new Error('INVALID_REQUEST');
      } catch (error) {
        failure(res, error);
      }
      return true;
    },
    async onBackendResponse(req: IncomingMessage, status: number): Promise<void> {
      const observation = observations.get(req);
      observations.delete(req);
      if (observation && status >= 200 && status < 300)
        await manager.cancelConversation(
          observation.conversationId,
          observation.deleted ? undefined : observation.epoch
        );
    },
    async close(): Promise<void> {
      await manager.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
