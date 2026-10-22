import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAuthService } from '../codexAuth.js';

const services: CodexAuthService[] = [];
afterEach(() => {
  for (const service of services) service.close();
  services.length = 0;
  vi.useRealTimers();
});

function fakeServer(
  options: { invalidUrl?: boolean; rejectLogin?: boolean; rejectCancel?: boolean; delayed?: boolean } = {}
) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
  });
  const methods: string[] = [];
  let account: unknown = null;
  let waitingLoginId: number | null = null;
  const reply = (id: number, result: unknown) => child.stdout.write(JSON.stringify({ id, result }) + '\n');
  const loginResult = {
    type: 'chatgptDeviceCode',
    loginId: 'login-1',
    userCode: 'TEST-CODE',
    verificationUrl: options.invalidUrl ? 'https://evil.example/code' : 'https://auth.openai.com/codex/device',
  };
  child.stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().trim().split('\n')) {
      const request = JSON.parse(line) as { id?: number; method: string };
      methods.push(request.method);
      if (!request.id) continue;
      if (request.method === 'account/read') reply(request.id, { account });
      else if (request.method === 'account/login/start') {
        if (options.rejectLogin)
          child.stdout.write(JSON.stringify({ id: request.id, error: { message: 'private upstream secret' } }) + '\n');
        else if (options.delayed) waitingLoginId = request.id;
        else reply(request.id, loginResult);
      } else if (request.method === 'account/login/cancel' && options.rejectCancel)
        child.stdout.write(JSON.stringify({ id: request.id, error: { message: 'unavailable' } }) + '\n');
      else {
        if (request.method === 'account/logout') account = null;
        reply(request.id, {});
      }
    }
  });
  const service = new CodexAuthService(() => child as unknown as ChildProcessWithoutNullStreams);
  services.push(service);
  return {
    service,
    methods,
    finish: () => {
      account = { type: 'chatgpt', email: 'test@example.com', accessToken: 'never expose this' };
      child.stdout.write(
        JSON.stringify({ method: 'account/login/completed', params: { loginId: 'login-1', success: true } }) + '\n'
      );
    },
    release: () => {
      if (waitingLoginId) reply(waitingLoginId, loginResult);
    },
  };
}

describe('Codex web device-code login', () => {
  it('reads account status without starting a model thread or authentication flow', async () => {
    const { service, methods } = fakeServer();
    expect((await service.status()).authenticated).toBe(false);
    expect(methods).toEqual(['initialize', 'initialized', 'account/read']);
  });

  it('shares one device login between concurrent browser requests', async () => {
    const { service, methods } = fakeServer();
    const [first, second] = await Promise.all([service.startLogin(), service.startLogin()]);
    expect(first.login).toMatchObject({ state: 'pending', userCode: 'TEST-CODE' });
    expect(second).toEqual(first);
    expect(methods.filter((method) => method === 'account/login/start')).toHaveLength(1);
  });

  it('clears the device code after successful authentication without exposing account tokens', async () => {
    const { service, finish } = fakeServer();
    await service.startLogin();
    finish();
    const status = await service.status();
    expect(status).toMatchObject({ authenticated: true, email: 'test@example.com', login: { state: 'succeeded' } });
    expect(status.login.userCode).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain('never expose this');
  });

  it('does not show an untrusted verification URL supplied by a malformed response', async () => {
    const { service } = fakeServer({ invalidUrl: true });
    await expect(service.startLogin()).rejects.toThrow(/^CODEX_AUTH_FAILED$/);
    expect((await service.status()).login).toEqual({ state: 'failed' });
  });

  it('does not forward raw CLI authentication errors to the browser', async () => {
    const { service } = fakeServer({ rejectLogin: true });
    await expect(service.startLogin()).rejects.toThrow(/^CODEX_AUTH_FAILED$/);
  });

  it('keeps a cancelled flow cancelled when a delayed login reply arrives', async () => {
    const { service, release, methods } = fakeServer({ delayed: true });
    const starting = service.startLogin();
    while (!methods.includes('account/login/start')) await new Promise<void>((resolve) => setImmediate(resolve));
    await service.cancelLogin();
    release();
    expect((await starting).login).toEqual({ state: 'cancelled' });
  });

  it('expires the displayed code even when the CLI cannot cancel it', async () => {
    vi.useFakeTimers();
    const { service } = fakeServer({ rejectCancel: true });
    await service.startLogin();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect((await service.status()).login).toEqual({ state: 'expired' });
  });
});
