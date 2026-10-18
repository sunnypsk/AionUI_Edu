import type { IncomingMessage, ServerResponse } from 'node:http';
import { CodexAuthService } from './codexAuth.js';
import { NetworkProxyStore } from './proxy.js';

type RuntimeControlsOptions = {
  backendPort: number;
  dataDir: string;
  sourceCommit?: string;
  releaseSequence?: string;
  auth?: Pick<CodexAuthService, 'status' | 'startLogin' | 'cancelLogin' | 'logout' | 'close'>;
  proxy?: Pick<NetworkProxyStore, 'status' | 'save'>;
};

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > 8192) throw new Error('REQUEST_TOO_LARGE');
  }
  try {
    return JSON.parse(body || '{}') as unknown;
  } catch {
    throw new Error('INVALID_REQUEST');
  }
}

/** The host reuses AionCore's session validation; no parallel password/auth store. */
export function createRuntimeControls(options: RuntimeControlsOptions) {
  const auth = options.auth ?? new CodexAuthService();
  const proxy = options.proxy ?? new NetworkProxyStore(options.dataDir);
  return {
    close: () => auth.close(),
    async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const route = req.url?.split('?')[0];
      if (route === '/healthz' && req.method === 'GET') {
        try {
          const backend = await fetch(`http://127.0.0.1:${options.backendPort}/api/auth/internal/users/system`, {
            signal: AbortSignal.timeout(3000),
          });
          await backend.arrayBuffer();
          send(res, backend.ok ? 200 : 503, {
            ok: backend.ok,
            app: 'aionui-edu',
            sourceCommit: options.sourceCommit ?? process.env.AIONUI_SOURCE_COMMIT ?? 'development',
            releaseSequence: options.releaseSequence ?? process.env.AIONUI_RELEASE_SEQUENCE ?? '0.0',
          });
        } catch {
          send(res, 503, { ok: false, app: 'aionui-edu' });
        }
        return true;
      }
      if (!route?.startsWith('/api/edu/')) return false;
      try {
        const credentials: Record<string, string> = {};
        if (req.headers.cookie) credentials.cookie = req.headers.cookie;
        if (req.headers.authorization) credentials.authorization = req.headers.authorization;
        if (Object.keys(credentials).length === 0) {
          send(res, 401, { error: { code: 'UNAUTHORIZED' } });
          return true;
        }
        const identity = await fetch(`http://127.0.0.1:${options.backendPort}/api/auth/user`, {
          headers: credentials,
          signal: AbortSignal.timeout(5000),
        });
        await identity.arrayBuffer();
        if (!identity.ok) {
          send(res, 401, { error: { code: 'UNAUTHORIZED' } });
          return true;
        }
        if (req.method !== 'GET') {
          const origin = req.headers.origin;
          if (
            req.headers['sec-fetch-site'] === 'cross-site' ||
            (origin && new URL(origin).host !== req.headers.host) ||
            !req.headers['content-type']?.startsWith('application/json')
          ) {
            send(res, 403, { error: { code: 'INVALID_ORIGIN' } });
            return true;
          }
        }
        let result: unknown;
        if (route === '/api/edu/codex/account' && req.method === 'GET') result = await auth.status();
        else if (route === '/api/edu/codex/login' && req.method === 'POST') {
          await readBody(req);
          result = await auth.startLogin();
        } else if (route === '/api/edu/codex/login/cancel' && req.method === 'POST') {
          await readBody(req);
          result = await auth.cancelLogin();
        } else if (route === '/api/edu/codex/logout' && req.method === 'POST') {
          await readBody(req);
          result = await auth.logout();
        } else if (route === '/api/edu/network-proxy' && req.method === 'GET') result = await proxy.status();
        else if (route === '/api/edu/network-proxy' && req.method === 'PUT')
          result = await proxy.save(await readBody(req));
        else {
          send(res, 404, { error: { code: 'NOT_FOUND' } });
          return true;
        }
        send(res, 200, { data: result });
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        const invalid = [
          'INVALID_REQUEST',
          'INVALID_PROXY_SETTINGS',
          'INVALID_SOCKS5_PROXY',
          'REQUEST_TOO_LARGE',
        ].includes(code);
        const locked = code === 'PROXY_MANAGED_BY_ENV';
        send(res, invalid ? 400 : locked ? 409 : 503, {
          error: { code: invalid || locked ? code : 'RUNTIME_CONTROL_UNAVAILABLE' },
        });
      }
      return true;
    },
  };
}
