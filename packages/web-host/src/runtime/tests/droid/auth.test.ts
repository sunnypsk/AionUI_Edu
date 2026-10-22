import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FactoryAccountService } from '../../droid/provider/auth.js';
import { FactoryProvider } from '../../droid/provider/sdk.js';
import type { DroidTransport } from '../../droid/provider/transport.js';

describe('Factory device-pairing account client', () => {
  let directory: string;
  let service: FactoryAccountService;
  let provider: FactoryProvider;
  let receive: (frame: string) => void;
  let authId: number;
  let supported: boolean;
  const sent: Record<string, unknown>[] = [];
  let close: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'aion-auth-'));
    sent.length = 0;
    supported = true;
    authId = 0;
    provider = new FactoryProvider(directory);
    vi.spyOn(provider, 'version').mockResolvedValue('0.245.1');
    vi.spyOn(provider, 'availableModels').mockResolvedValue({ argon: true, opus: true });
    close = vi.fn(async () => {});
    vi.spyOn(provider, 'transport').mockImplementation(
      async () =>
        ({
          onError: () => {},
          onMessage: (callback: (frame: string) => void) => {
            receive = callback;
          },
          close,
          send: async (line: string) => {
            const frame = JSON.parse(line) as Record<string, unknown>;
            sent.push(frame);
            if (frame.method === 'initialize')
              queueMicrotask(() =>
                receive(
                  JSON.stringify({
                    id: frame.id,
                    result: {
                      authMethods: supported ? [{ id: 'device-pairing' }] : [],
                      agentCapabilities: { auth: { logout: {} } },
                    },
                  })
                )
              );
            if (frame.method === 'authenticate') {
              authId = frame.id as number;
              queueMicrotask(() =>
                receive(
                  JSON.stringify({
                    id: 'url',
                    method: 'elicitation/create',
                    params: { mode: 'url', url: 'https://app.factory.ai/activate?user_code=fixture' },
                  })
                )
              );
            }
            if (frame.method === 'logout') queueMicrotask(() => receive(JSON.stringify({ id: frame.id, result: {} })));
          },
        }) as unknown as DroidTransport
    );
    service = new FactoryAccountService(provider, 'teacher', async () => true);
  });
  afterEach(async () => {
    await service.close();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  it('surfaces the official URL and accepts elicitation without requesting a terminal or files', async () => {
    service.login();
    await vi.waitFor(async () => expect((await service.status()).login.state).toBe('pending'));
    expect(sent[0]).toMatchObject({
      method: 'initialize',
      params: {
        clientCapabilities: {
          terminal: false,
          fs: { readTextFile: false, writeTextFile: false },
          elicitation: { url: {} },
        },
      },
    });
    expect(sent).toContainEqual({ jsonrpc: '2.0', id: 'url', result: { action: 'accept' } });
  });
  it('ignores stale completion after cancellation and removes the device URL', async () => {
    service.login();
    await vi.waitFor(() => expect(authId).toBeGreaterThan(0));
    await service.cancel();
    receive(JSON.stringify({ id: authId, result: {} }));
    expect((await service.status()).login).toEqual({ state: 'cancelled' });
    expect(close).toHaveBeenCalled();
  });
  it('marks successful authentication without persisting the login URL', async () => {
    service.login();
    await vi.waitFor(async () => expect((await service.status()).login.state).toBe('pending'));
    receive(JSON.stringify({ id: authId, result: {} }));
    await vi.waitFor(async () => expect((await service.status()).login).toEqual({ state: 'succeeded' }));
    expect((await service.status()).authenticated).toBe(true);
  });
  it('fails closed when device pairing is not advertised', async () => {
    supported = false;
    service.login();
    await vi.waitFor(async () => expect((await service.status()).login.state).toBe('failed'));
    expect(sent.some((frame) => frame.method === 'authenticate')).toBe(false);
  });
  it('uses the advertised logout method without launching a model session', async () => {
    await service.logout();
    expect(sent.map((frame) => frame.method)).toEqual(['initialize', 'logout']);
  });
  it('does not allow a second tab to start login during logout', async () => {
    const logout = service.logout();
    expect(() => service.login()).toThrow('FACTORY_ACCOUNT_BUSY');
    await expect(service.logout()).rejects.toThrow('FACTORY_ACCOUNT_BUSY');
    await logout;
  });
  it('rejects an elicitation URL outside Factory', async () => {
    service.login();
    await vi.waitFor(async () => expect((await service.status()).login.state).toBe('pending'));
    receive(
      JSON.stringify({
        id: 'bad',
        method: 'elicitation/create',
        params: { mode: 'url', url: 'https://example.com/fake' },
      })
    );
    await vi.waitFor(async () => expect((await service.status()).login.state).toBe('failed'));
    expect(sent.some((frame) => frame.id === 'bad' && frame.result)).toBe(false);
  });
});
