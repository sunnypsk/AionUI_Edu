import { SessionValidator, rateLimitError, sendSessionAuthError } from '../sessionAuth.js';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { verifyBrowserCapability } from '../browser/types.js';
import { SpecialistManager } from './manager.js';
import { FactoryProvider } from './provider/index.js';
import { FactoryAccountService } from './provider/auth.js';
import { DroidUpdateService } from './runtime/updates.js';
import { idSchema, toolSchemas, errorCode, type Owner, type ToolName } from './types.js';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const lifecycleSchema = z
  .object({
    event: z.enum(['start', 'bound', 'stop']),
    event_id: z.string().max(256).optional(),
    thread_id: z.string().max(256),
    turn_id: z.string().max(256).optional(),
  })
  .strict();
const send = (res: ServerResponse, status: number, value: unknown): void => {
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
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1100000) throw new Error('INVALID_REQUEST');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
  } catch {
    throw new Error('INVALID_REQUEST');
  }
}

/** Public cookie-authenticated controls and a private capability-scoped MCP gateway. */
export async function createSpecialistRuntime(options: {
  dataDir: string;
  sessionAuth?: SessionValidator;
  manager?: SpecialistManager;
  provider?: FactoryProvider;
  updates?: DroidUpdateService;
}) {
  const provider = options.provider ?? new FactoryProvider(options.dataDir);
  const updates = options.updates ?? new DroidUpdateService(provider);
  const manager = options.manager ?? new SpecialistManager(options.dataDir, provider);
  const accounts = new Map<string, FactoryAccountService>();
  const observations = new WeakMap<IncomingMessage, { conversationId: string; epoch: number; deleted: boolean }>();
  const key = randomBytes(32).toString('hex');
  let backendPort = 0;
  const sessionAuth = options.sessionAuth ?? new SessionValidator(() => backendPort);
  const backend = async (route: string, headers: Record<string, string>): Promise<Record<string, unknown>> => {
    if (!backendPort) throw new Error('SPECIALIST_UNAVAILABLE');
    const response = await fetch(`http://127.0.0.1:${backendPort}${route}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 429) {
      await response.body?.cancel();
      throw rateLimitError(response);
    }
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'UNAUTHORIZED'
          : response.status === 403 || response.status === 404
            ? 'SPECIALIST_FORBIDDEN'
            : 'SPECIALIST_UNAVAILABLE'
      );
    const result = record(await response.json());
    return result.data ? record(result.data) : result;
  };
  const owner = async (
    id: string,
    headers: Record<string, string>,
    expectedUser: string,
    currentIdentity?: Record<string, unknown>
  ): Promise<Owner> => {
    idSchema.parse(id);
    const identity = currentIdentity ?? (await backend('/api/system/current-user', headers));
    if (identity.id !== expectedUser) throw new Error('UNAUTHORIZED');
    const conversation = await backend(`/api/conversations/${encodeURIComponent(id)}`, headers);
    const workspace = record(conversation.extra).workspace;
    if (conversation.id !== id || typeof workspace !== 'string' || !path.isAbsolute(workspace))
      throw new Error('SPECIALIST_FORBIDDEN');
    return { userId: expectedUser, conversationId: id, workspace };
  };
  const account = (userId: string): FactoryAccountService => {
    let service = accounts.get(userId);
    if (!service) {
      service = new FactoryAccountService(provider, userId);
      accounts.set(userId, service);
    }
    return service;
  };
  const failure = (res: ServerResponse, error: unknown): void => {
    if (sendSessionAuthError(res, error)) return;
    const code = error instanceof z.ZodError ? 'INVALID_REQUEST' : errorCode(error);
    if (res.destroyed || res.headersSent) return;
    send(
      res,
      code === 'UNAUTHORIZED' ? 401 : code === 'SPECIALIST_FORBIDDEN' ? 403 : code === 'INVALID_REQUEST' ? 400 : 409,
      { error: { code } }
    );
  };
  const command = async (context: Owner, name: ToolName, input: unknown, signal: AbortSignal): Promise<unknown> => {
    switch (name) {
      case 'specialist_start': {
        const p = toolSchemas[name].parse(input);
        return manager.start(context, p.specialist, p.prompt, p.files);
      }
      case 'specialist_reply': {
        const p = toolSchemas[name].parse(input);
        return manager.reply(context, p.task_id, p.prompt, p.files);
      }
      case 'specialist_wait': {
        const p = toolSchemas[name].parse(input);
        return manager.wait(context, p.task_ids, p.wait_sec, signal);
      }
      case 'specialist_get': {
        const p = toolSchemas[name].parse(input);
        return p.task_id ? manager.get(context, p.task_id, p.run_id, p.offset) : manager.list(context);
      }
      case 'specialist_cancel': {
        const p = toolSchemas[name].parse(input);
        return manager.cancel(context, p.task_id);
      }
      default:
        throw new Error('INVALID_REQUEST');
    }
  };
  const privateServer = http.createServer((req, res) => {
    void (async () => {
      const abort = new AbortController();
      res.once('close', () => abort.abort());
      try {
        if (
          !['/command', '/lifecycle'].includes(req.url ?? '') ||
          req.method !== 'POST' ||
          req.headers.origin ||
          req.headers['sec-fetch-site']
        )
          throw new Error('UNAUTHORIZED');
        const capability = req.headers['x-aionui-specialist-capability'];
        const token = req.headers['x-aionui-runtime-token'];
        if (typeof capability !== 'string' || typeof token !== 'string') throw new Error('UNAUTHORIZED');
        const claims = verifyBrowserCapability(key, capability);
        const context = await owner(
          claims.conversationId,
          {
            'x-aionui-runtime-token': token,
            'x-aionui-user-id': claims.userId,
            'x-aionui-conversation-id': claims.conversationId,
          },
          claims.userId
        );
        const input = await body(req);
        if (req.url === '/lifecycle') {
          const p = lifecycleSchema.parse(input);
          if (p.event === 'start' && p.event_id) await manager.parentStart(context, p.event_id, p.thread_id);
          else if (p.event === 'bound' && p.event_id && p.turn_id)
            await manager.parentBound(context, p.event_id, p.turn_id);
          else if (p.event === 'stop' && p.turn_id) await manager.parentStop(context, p.thread_id, p.turn_id);
          else throw new Error('INVALID_REQUEST');
          send(res, 200, { data: { ok: true } });
        } else {
          const p = z
            .object({
              name: z.enum([
                'specialist_start',
                'specialist_reply',
                'specialist_wait',
                'specialist_get',
                'specialist_cancel',
              ]),
              arguments: z.unknown(),
            })
            .strict()
            .parse(input);
          send(res, 200, { data: await command(context, p.name, p.arguments, abort.signal) });
        }
      } catch (error) {
        failure(res, error);
      }
    })();
  });
  privateServer.requestTimeout = 60000;
  await new Promise<void>((resolve, reject) => {
    privateServer.once('error', reject);
    privateServer.listen(0, '127.0.0.1', resolve);
  });
  return {
    env: {
      AIONUI_SPECIALISTS_GATEWAY: `http://127.0.0.1:${(privateServer.address() as { port: number }).port}`,
      AIONUI_SPECIALISTS_SIGNING_KEY: key,
    },
    setBackendPort(port: number): void {
      backendPort = port;
    },
    async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const lifecycle = /^\/api\/conversations\/([\w-]+)(\/cancel)?$/.exec(url.pathname);
      if (lifecycle && ((req.method === 'POST' && lifecycle[2]) || (req.method === 'DELETE' && !lifecycle[2]))) {
        observations.set(req, {
          conversationId: lifecycle[1],
          epoch: await manager.epoch(lifecycle[1]),
          deleted: req.method === 'DELETE',
        });
      }
      if (!url.pathname.startsWith('/api/edu/factory/') && !url.pathname.startsWith('/api/edu/specialists/'))
        return false;
      try {
        const headers: Record<string, string> = {};
        if (req.headers.cookie) headers.cookie = req.headers.cookie;
        if (req.headers.authorization) headers.authorization = req.headers.authorization;
        const userId = await sessionAuth.validate(headers);
        const identity = await backend('/api/system/current-user', headers);
        if (identity.id !== userId) throw new Error('UNAUTHORIZED');
        if (
          req.method === 'POST' &&
          (req.headers['sec-fetch-site'] === 'cross-site' ||
            (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) ||
            !req.headers['content-type']?.startsWith('application/json'))
        )
          throw new Error('SPECIALIST_FORBIDDEN');
        const authRoute = url.pathname.slice('/api/edu/factory/'.length);
        if (url.pathname.startsWith('/api/edu/factory/')) {
          const service = account(userId);
          if (req.method === 'GET' && authRoute === 'models')
            send(res, 200, { data: await provider.models(userId, url.searchParams.get('refresh') === '1') });
          else if (req.method === 'GET' && authRoute === 'settings')
            send(res, 200, { data: await provider.preferences.get(userId) });
          else if (req.method === 'POST' && authRoute === 'settings') {
            const input = await body(req);
            const catalog = await provider.models(userId, true);
            const saved = await provider.preferences.save(userId, input, catalog.models);
            service.invalidate();
            send(res, 200, { data: saved });
          } else if (req.method === 'GET' && authRoute === 'version') send(res, 200, { data: await updates.status() });
          else if (req.method === 'GET' && authRoute === 'account')
            send(res, 200, { data: await service.status(url.searchParams.get('refresh') === '1') });
          else if (req.method === 'POST') {
            z.object({})
              .strict()
              .parse(await body(req));
            if (authRoute === 'check-update') send(res, 200, { data: await updates.check() });
            else if (authRoute === 'install-update') send(res, 200, { data: await updates.install(userId) });
            else if (authRoute === 'login') send(res, 200, { data: service.login() });
            else if (authRoute === 'login/cancel') send(res, 200, { data: await service.cancel() });
            else if (authRoute === 'logout') {
              await manager.cancelUser(userId);
              send(res, 200, { data: await service.logout() });
            } else throw new Error('INVALID_REQUEST');
          } else throw new Error('INVALID_REQUEST');
        } else {
          const context = await owner(url.searchParams.get('conversation_id') ?? '', headers, userId, identity);
          if (req.method === 'GET' && url.pathname === '/api/edu/specialists/tasks') {
            const p = toolSchemas.specialist_get.parse({
              task_id: url.searchParams.get('task_id') ?? undefined,
              run_id: url.searchParams.get('run_id') ?? undefined,
              offset: Number(url.searchParams.get('offset') ?? 0),
            });
            send(res, 200, {
              data: p.task_id ? await manager.get(context, p.task_id, p.run_id, p.offset) : await manager.list(context),
            });
          } else if (req.method === 'POST' && url.pathname === '/api/edu/specialists/cancel') {
            const p = z
              .object({ task_id: z.string().uuid().optional() })
              .strict()
              .parse(await body(req));
            if (p.task_id) await manager.cancel(context, p.task_id);
            else await manager.cancelConversation(context.conversationId, undefined, userId);
            send(res, 200, { data: await manager.list(context) });
          } else throw new Error('INVALID_REQUEST');
        }
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
      await updates.close();
      await Promise.all([...accounts.values()].map((service) => service.close()));
      await manager.close();
      privateServer.closeAllConnections();
      await new Promise<void>((resolve) => privateServer.close(() => resolve()));
    },
  };
}
