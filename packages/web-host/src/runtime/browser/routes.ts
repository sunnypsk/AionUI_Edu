import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { SharedBrowserManager } from './manager.js';
import { browserActionSchema, BrowserRuntimeError, verifyBrowserCapability, type BrowserOwner } from './types.js';

export { signBrowserCapability, verifyBrowserCapability } from './types.js';

const ID = /^[a-zA-Z0-9_-]{1,160}$/;
const SAFE_ERRORS = new Set([
  'INVALID_REQUEST',
  'INVALID_BROWSER_URL',
  'BROWSER_FORBIDDEN',
  'BROWSER_HUMAN_CONTROL',
  'BROWSER_AGENT_CONTROL',
  'BROWSER_PAGE_CHANGED',
  'BROWSER_AGENT_DISABLED',
  'BROWSER_TAB_NOT_FOUND',
  'BROWSER_TAB_LIMIT',
  'BROWSER_NO_FILE_CHOOSER',
  'BROWSER_NO_DIALOG',
  'BROWSER_DIALOG_OPEN',
  'BROWSER_SELECTOR_AMBIGUOUS',
  'BROWSER_SELECTOR_NOT_FOUND',
  'BROWSER_FILE_TOO_LARGE',
  'BROWSER_FILE_NOT_FOUND',
  'BROWSER_PROFILE_LOCKED',
  'BROWSER_RESOURCES_UNAVAILABLE',
  'BROWSER_START_FAILED',
  'BROWSER_TIMEOUT',
  'UNAUTHORIZED',
]);

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 42_100_000) throw new Error('BROWSER_FILE_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}') as unknown;
  } catch {
    throw new Error('INVALID_REQUEST');
  }
}

function unwrap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('UNAUTHORIZED');
  const object = value as Record<string, unknown>;
  return object.data && typeof object.data === 'object' && !Array.isArray(object.data)
    ? (object.data as Record<string, unknown>)
    : object;
}

/** Authenticated public controls and a separate loopback-only MCP bridge share the same manager. */
export async function createBrowserRuntime(options: { dataDir: string; manager?: SharedBrowserManager }) {
  const manager = options.manager ?? new SharedBrowserManager(options.dataDir);
  const key = randomBytes(32).toString('hex');
  const sessions = new Map<string, { expiresAt: number; validation: Promise<string> }>();
  let backendPort = 0;
  const backend = async (route: string, headers: Record<string, string>): Promise<Record<string, unknown>> => {
    if (!backendPort) throw new Error('BROWSER_UNAVAILABLE');
    const response = await fetch(`http://127.0.0.1:${backendPort}${route}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'UNAUTHORIZED'
          : response.status === 403 || response.status === 404
            ? 'BROWSER_FORBIDDEN'
            : 'BROWSER_UNAVAILABLE'
      );
    return unwrap(await response.json());
  };
  // The auth router rate-limits its endpoints. Share a short validation lease across
  // frame/activity polls; never cache runtime tokens, cookies, or failed validations.
  const validateSession = async (headers: Record<string, string>): Promise<string> => {
    const hash = createHash('sha256').update(JSON.stringify(headers)).digest('hex');
    const cached = sessions.get(hash);
    if (cached && cached.expiresAt > Date.now()) return cached.validation;
    if (sessions.size >= 256) sessions.delete(sessions.keys().next().value!);
    const validation = backend('/api/auth/user', headers).then((identity) => {
      const user =
        identity.user && typeof identity.user === 'object' ? (identity.user as Record<string, unknown>) : identity;
      if (typeof user.id !== 'string' || !ID.test(user.id)) throw new Error('UNAUTHORIZED');
      return user.id;
    });
    sessions.set(hash, { expiresAt: Date.now() + 15000, validation });
    try {
      return await validation;
    } catch (error) {
      sessions.delete(hash);
      throw error;
    }
  };
  const owner = async (id: string, headers: Record<string, string>, expectedUser?: string): Promise<BrowserOwner> => {
    if (!ID.test(id)) throw new Error('INVALID_REQUEST');
    const identity = await backend('/api/system/current-user', headers);
    if (typeof identity.id !== 'string' || (expectedUser && identity.id !== expectedUser))
      throw new Error('UNAUTHORIZED');
    const conversation = await backend(`/api/conversations/${encodeURIComponent(id)}`, headers);
    const extra = conversation.extra;
    const workspace = extra && typeof extra === 'object' && 'workspace' in extra ? extra.workspace : undefined;
    if (conversation.id !== id || typeof workspace !== 'string' || !path.isAbsolute(workspace))
      throw new Error('BROWSER_FORBIDDEN');
    return { userId: identity.id, conversationId: id, workspace };
  };
  const failure = (res: ServerResponse, error: unknown): void => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const message = error instanceof Error ? error.message : '';
    const code = SAFE_ERRORS.has(message)
      ? message
      : error instanceof Error && error.name === 'TimeoutError'
        ? 'BROWSER_TIMEOUT'
        : 'BROWSER_UNAVAILABLE';
    const stage = error instanceof BrowserRuntimeError ? error.stage : 'request';
    const diagnosticId = randomUUID();
    if (
      [
        'BROWSER_UNAVAILABLE',
        'BROWSER_PROFILE_LOCKED',
        'BROWSER_RESOURCES_UNAVAILABLE',
        'BROWSER_START_FAILED',
        'BROWSER_TIMEOUT',
      ].includes(code)
    )
      console.warn(JSON.stringify({ event: 'browser.failed', code, stage, diagnostic_id: diagnosticId }));
    send(
      res,
      code === 'UNAUTHORIZED' ? 401 : code === 'BROWSER_FORBIDDEN' ? 403 : code.startsWith('INVALID_') ? 400 : 409,
      {
        error: {
          code,
          stage,
          diagnostic_id: diagnosticId,
          ...(error instanceof BrowserRuntimeError && error.details ? { details: error.details } : {}),
        },
      }
    );
  };
  const privateServer = http.createServer((req, res) => {
    void (async () => {
      try {
        if (req.url !== '/command' || req.method !== 'POST' || req.headers.origin || req.headers['sec-fetch-site'])
          throw new Error('UNAUTHORIZED');
        const capability = req.headers['x-aionui-browser-capability'];
        if (typeof capability !== 'string') throw new Error('UNAUTHORIZED');
        const claims = verifyBrowserCapability(key, capability);
        const token = req.headers['x-aionui-runtime-token'];
        if (typeof token !== 'string') throw new Error('UNAUTHORIZED');
        const context = await owner(
          claims.conversationId,
          {
            'x-aionui-runtime-token': token,
            'x-aionui-user-id': claims.userId,
            'x-aionui-conversation-id': claims.conversationId,
          },
          claims.userId
        );
        const parsed = browserActionSchema.safeParse(await body(req));
        if (!parsed.success) throw new Error('INVALID_REQUEST');
        send(res, 200, { data: await manager.act(context, 'agent', parsed.data) });
      } catch (error) {
        failure(res, error);
      }
    })();
  });
  privateServer.requestTimeout = 20000;
  await new Promise<void>((resolve, reject) => {
    privateServer.once('error', reject);
    privateServer.listen(0, '127.0.0.1', resolve);
  });
  const port = (privateServer.address() as { port: number }).port;
  return {
    env: { AIONUI_BROWSER_GATEWAY: `http://127.0.0.1:${port}/command`, AIONUI_BROWSER_SIGNING_KEY: key },
    setBackendPort: (value: number): void => {
      backendPort = value;
    },
    async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/edu/browser/')) return false;
      try {
        if (url.pathname === '/api/edu/browser/preferences') {
          const credentials: Record<string, string> = {};
          if (req.headers.cookie) credentials.cookie = req.headers.cookie;
          if (req.headers.authorization) credentials.authorization = req.headers.authorization;
          if (!Object.keys(credentials).length) throw new Error('UNAUTHORIZED');
          const sessionUser = await validateSession(credentials);
          const user = await backend('/api/system/current-user', credentials);
          if (user.id !== sessionUser) throw new Error('BROWSER_FORBIDDEN');
          if (req.method === 'GET') send(res, 200, { data: await manager.getPreferences(user.id) });
          else if (req.method === 'POST') {
            if (
              req.headers['sec-fetch-site'] === 'cross-site' ||
              (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) ||
              !req.headers['content-type']?.startsWith('application/json')
            )
              throw new Error('BROWSER_FORBIDDEN');
            const settings = unwrap(await body(req));
            if (Object.keys(settings).join() === 'clear' && settings.clear === true) {
              await manager.clearData(user.id);
              send(res, 200, { data: { cleared: true } });
            } else if (Object.keys(settings).join() === 'agentEnabled' && typeof settings.agentEnabled === 'boolean')
              send(res, 200, { data: await manager.setPreferences(user.id, { agentEnabled: settings.agentEnabled }) });
            else throw new Error('INVALID_REQUEST');
          } else throw new Error('INVALID_REQUEST');
          return true;
        }
        const match = /^\/api\/edu\/browser\/([\w-]+)\/(state|frame|action|control|download)$/.exec(url.pathname);
        if (!match) throw new Error('INVALID_REQUEST');
        const [, id, operation] = match;
        const headers: Record<string, string> = {};
        if (req.headers.cookie) headers.cookie = req.headers.cookie;
        if (req.headers.authorization) headers.authorization = req.headers.authorization;
        if (!Object.keys(headers).length) throw new Error('UNAUTHORIZED');
        // Local backend identity is intentionally insufficient: require a real WebUI session.
        const sessionUser = await validateSession(headers);
        const context = await owner(id, headers, sessionUser);
        if (req.method === 'GET' && operation === 'state') send(res, 200, { data: manager.state(context) });
        else if (req.method === 'GET' && operation === 'frame') send(res, 200, { data: await manager.frame(context) });
        else if (req.method === 'GET' && operation === 'download') {
          const file = await manager.download(context, url.searchParams.get('id') ?? '');
          const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          await pipeline(handle.createReadStream(), res);
        } else if (req.method === 'POST' && ['action', 'control'].includes(operation)) {
          if (
            req.headers['sec-fetch-site'] === 'cross-site' ||
            (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) ||
            !req.headers['content-type']?.startsWith('application/json')
          )
            throw new Error('BROWSER_FORBIDDEN');
          const input = await body(req);
          if (operation === 'control') {
            const value = unwrap(input);
            if (Object.keys(value).join() !== 'control' || !['human', 'agent'].includes(String(value.control)))
              throw new Error('INVALID_REQUEST');
            send(res, 200, { data: await manager.control(context, value.control as 'human' | 'agent') });
          } else {
            const parsed = browserActionSchema.safeParse(input);
            if (!parsed.success) throw new Error('INVALID_REQUEST');
            if (parsed.data.kind === 'uploadPath') throw new Error('BROWSER_FORBIDDEN');
            send(res, 200, { data: await manager.act(context, 'human', parsed.data) });
          }
        } else throw new Error('INVALID_REQUEST');
      } catch (error) {
        failure(res, error);
      }
      return true;
    },
    async close(): Promise<void> {
      sessions.clear();
      await new Promise<void>((resolve) => {
        privateServer.close(() => resolve());
        privateServer.closeAllConnections();
      });
      await manager.close();
    },
  };
}
