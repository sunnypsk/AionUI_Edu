import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** A transient auth failure must keep its HTTP status across the host boundary. */
export class SessionAuthError extends Error {
  constructor(
    readonly status: number,
    code: string,
    readonly retryAfter?: string
  ) {
    super(code);
  }
}

function retryDelay(value: string | null): number {
  if (!value?.trim()) return 5000;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 5000;
}

/** Preserve Core's rate-limit response, including an HTTP-date Retry-After. */
export function rateLimitError(response: Response): SessionAuthError {
  const value = response.headers.get('retry-after');
  const seconds = value?.trim() ? Number(value) : NaN;
  const valid = value && (Number.isFinite(seconds) ? seconds > 0 : Date.parse(value) > Date.now());
  return new SessionAuthError(429, 'RATE_LIMITED', valid ? value : '5');
}

/** Write shared auth failures before a runtime's own domain-error mapping. */
export function sendSessionAuthError(res: ServerResponse, error: unknown): boolean {
  if (!(error instanceof SessionAuthError)) return false;
  if (res.destroyed || res.headersSent) return true;
  res.writeHead(error.status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...(error.retryAfter ? { 'retry-after': error.retryAfter } : {}),
  });
  res.end(JSON.stringify({ error: { code: error.message } }));
  return true;
}

type Validation = { expiresAt: number; promise: Promise<string> };

/** A bounded, credential-isolated lease shared by all public runtime routes. */
export class SessionValidator {
  private readonly sessions = new Map<string, Validation>();

  constructor(private readonly backendPort: () => number) {}

  clear(): void {
    this.sessions.clear();
  }

  onBackendResponse(req: IncomingMessage, status: number): void {
    if (req.method === 'POST' && req.url?.split('?')[0] === '/logout' && status >= 200 && status < 300) this.clear();
  }

  async validate(headers: Record<string, string>): Promise<string> {
    const credentials = { cookie: headers.cookie ?? '', authorization: headers.authorization ?? '' };
    if (!credentials.cookie && !credentials.authorization) throw new SessionAuthError(401, 'UNAUTHORIZED');
    const key = createHash('sha256').update(JSON.stringify(credentials)).digest('hex');
    const cached = this.sessions.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    if (this.sessions.size >= 256) this.sessions.delete(this.sessions.keys().next().value!);
    // Pending validations cannot expire into parallel requests; timeout bounds their lifetime.
    const entry: Validation = { expiresAt: Infinity, promise: Promise.resolve('') };
    entry.promise = this.request(credentials).then(
      (userId) => {
        entry.expiresAt = Date.now() + 15000;
        return userId;
      },
      (error: unknown) => {
        if (error instanceof SessionAuthError && error.status === 429)
          entry.expiresAt = Date.now() + retryDelay(error.retryAfter ?? null);
        else if (this.sessions.get(key) === entry) this.sessions.delete(key);
        throw error;
      }
    );
    this.sessions.set(key, entry);
    return entry.promise;
  }

  private async request(headers: Record<string, string>): Promise<string> {
    try {
      const port = this.backendPort();
      if (!port) throw new SessionAuthError(503, 'AUTH_UNAVAILABLE');
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/user`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw rateLimitError(response);
        throw new SessionAuthError(
          response.status === 401 || response.status === 403 ? response.status : 503,
          response.status === 401 ? 'UNAUTHORIZED' : response.status === 403 ? 'FORBIDDEN' : 'AUTH_UNAVAILABLE'
        );
      }
      const result: unknown = await response.json();
      const envelope = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      const data = envelope.data ?? envelope;
      const identity = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const user = identity.user ?? identity;
      const id = user && typeof user === 'object' ? (user as Record<string, unknown>).id : undefined;
      if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) throw new SessionAuthError(401, 'UNAUTHORIZED');
      return id;
    } catch (error) {
      if (error instanceof SessionAuthError) throw error;
      throw new SessionAuthError(503, 'AUTH_UNAVAILABLE');
    }
  }
}
