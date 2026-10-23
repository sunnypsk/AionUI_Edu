import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { verifyBrowserCapability } from '../runtime/browser/types.js';
import { AudioManager } from './manager.js';
import {
  agentTask,
  audioError,
  ownerId,
  settingsSchema,
  toolSchemas,
  type AudioOwner,
  type AudioToolName,
} from './types.js';
import { AudioProjectError } from './track/index.js';

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
    if (bytes > 1000000) throw new Error('INVALID_REQUEST');
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
    return result.data ? record(result.data) : result;
  };
  const owner = async (
    userId: string,
    conversationId: string,
    headers: Record<string, string>
  ): Promise<AudioOwner> => {
    ownerId.parse(userId);
    ownerId.parse(conversationId);
    const identity = await backend('/api/system/current-user', headers);
    if (identity.id !== userId) throw new Error('UNAUTHORIZED');
    const conversation = await backend(`/api/conversations/${encodeURIComponent(conversationId)}`, headers);
    const workspace = record(conversation.extra).workspace;
    if (conversation.id !== conversationId || typeof workspace !== 'string' || !path.isAbsolute(workspace))
      throw new Error('AUDIO_FILE_FORBIDDEN');
    return { userId, conversationId, workspace };
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
        if (url.pathname === '/api/edu/audio/settings' && req.method === 'GET')
          send(res, 200, { data: await manager.store.settings(userId) });
        else if (url.pathname === '/api/edu/audio/settings' && req.method === 'POST') {
          const value = settingsSchema.parse(await body(req));
          const previous = await manager.store.settings(userId);
          if (value.model !== previous.model) await manager.catalog.resolve(value.model);
          send(res, 200, { data: await manager.store.saveSettings(userId, value) });
        } else if (url.pathname === '/api/edu/audio/models' && req.method === 'GET')
          send(res, 200, { data: await manager.catalog.get(url.searchParams.get('refresh') === '1') });
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
