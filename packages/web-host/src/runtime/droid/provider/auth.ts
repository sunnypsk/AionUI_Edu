import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { environment } from './environment.js';
import type { FactoryProvider } from './sdk.js';
import type { DroidTransport } from './transport.js';
import { errorCode, type FactoryAccount } from '../types.js';

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const execute = promisify(execFile);

/** Factory's ACP device pairing owns OAuth and encrypted credential storage. No inference is sent. */
export class FactoryAccountService {
  private snapshot: FactoryAccount = {
    available: false,
    version: null,
    authenticated: false,
    models: { argon: false, opus: false },
    login: { state: 'idle' },
  };
  private transport?: DroidTransport;
  private generation = 0;
  private sequence = 0;
  private expires?: ReturnType<typeof setTimeout>;
  private checkedAt = 0;
  private checking?: Promise<FactoryAccount>;
  private loggingOut = false;
  private unsupported = false;
  private readonly pending = new Map<number, Pending>();
  constructor(
    private readonly provider: FactoryProvider,
    private readonly userId: string,
    private readonly verifyCredentials?: () => Promise<boolean>
  ) {}

  private async verify(): Promise<boolean> {
    if (this.verifyCredentials) return this.verifyCredentials();
    const context = await environment(this.provider.dataDir, this.userId);
    let stdout: string;
    try {
      stdout = (
        await execute(this.provider.command, ['doctor', '--checks', 'auth', '--json'], {
          ...context,
          windowsHide: true,
          timeout: 15000,
          maxBuffer: 256000,
        })
      ).stdout;
    } catch (error) {
      stdout = typeof (error as { stdout?: unknown }).stdout === 'string' ? (error as { stdout: string }).stdout : '';
    }
    const result = record(JSON.parse(stdout));
    const checks = Array.isArray(result.results) ? result.results : [];
    return checks.some((value: unknown) => {
      const item = record(value);
      return item.id === 'auth.verify' && item.status === 'pass';
    });
  }

  async status(force = false): Promise<FactoryAccount> {
    if (this.checking) {
      if (!force) return this.checking;
      await this.checking;
    }
    if (!force && (Date.now() - this.checkedAt < 60000 || ['starting', 'pending'].includes(this.snapshot.login.state)))
      return structuredClone(this.snapshot);
    const generation = this.generation;
    this.checking = (async () => {
      try {
        const version = await this.provider.version();
        const authenticated = await this.verify();
        const models = await this.provider.availableModels(this.userId).catch(() => ({ argon: false, opus: false }));
        if (generation === this.generation)
          this.snapshot = {
            ...this.snapshot,
            version,
            available: !this.unsupported,
            authenticated,
            models,
            error: undefined,
          };
      } catch (error) {
        if (generation === this.generation)
          this.snapshot = { ...this.snapshot, available: false, authenticated: false, error: errorCode(error) };
      }
      this.checkedAt = Date.now();
      return structuredClone(this.snapshot);
    })().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }
  private request(method: string, params: unknown, timeout = 15000): Promise<Record<string, unknown>> {
    const transport = this.transport;
    if (!transport) return Promise.reject(new Error('FACTORY_AUTH_UNAVAILABLE'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('FACTORY_AUTH_TIMEOUT'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      void transport.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })).catch(() => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('FACTORY_AUTH_UNAVAILABLE'));
      });
    });
  }
  private async connect(generation: number): Promise<void> {
    const context = await environment(this.provider.dataDir, this.userId);
    const transport = await this.provider.transport(context, 'acp');
    if (generation !== this.generation) {
      await transport.close();
      throw new Error('FACTORY_AUTH_CANCELLED');
    }
    this.transport = transport;
    transport.onError(() => {
      if (generation !== this.generation || this.transport !== transport) return;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('FACTORY_AUTH_UNAVAILABLE'));
      }
      this.pending.clear();
    });
    transport.onMessage((line) => {
      if (generation !== this.generation) return;
      let frame: Record<string, unknown>;
      try {
        frame = record(JSON.parse(line));
      } catch {
        void this.disconnect();
        return;
      }
      if (frame.method === 'elicitation/create' && (typeof frame.id === 'number' || typeof frame.id === 'string')) {
        const params = record(frame.params);
        let url: URL;
        try {
          url = new URL(String(params.url));
        } catch {
          void this.disconnect();
          return;
        }
        if (
          params.mode !== 'url' ||
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          !['factory.ai', 'factory.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
        ) {
          void this.disconnect();
          return;
        }
        this.snapshot.login = { state: 'pending', url: url.href, expiresAt: Date.now() + 15 * 60 * 1000 };
        void transport
          .send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { action: 'accept' } }))
          .catch(() => this.disconnect());
      } else if (typeof frame.method === 'string' && frame.id !== undefined) {
        void transport
          .send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: frame.id,
              error: { code: -32601, message: 'Unsupported account-only client request' },
            })
          )
          .catch(() => this.disconnect());
      } else if (typeof frame.id === 'number') {
        const pending = this.pending.get(frame.id);
        if (!pending) return;
        this.pending.delete(frame.id);
        clearTimeout(pending.timer);
        if (frame.error) pending.reject(new Error('FACTORY_AUTH_FAILED'));
        else pending.resolve(record(frame.result));
      }
    });
    const init = await this.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'aionui-factory-account', version: '1.0.0' },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        elicitation: { url: {} },
      },
    });
    const methods = Array.isArray(init.authMethods) ? init.authMethods : [];
    if (
      !methods.some((value: unknown) => record(value).id === 'device-pairing') ||
      !('logout' in record(record(init.agentCapabilities).auth))
    ) {
      this.unsupported = true;
      this.snapshot.available = false;
      throw new Error('FACTORY_AUTH_UNSUPPORTED');
    }
  }
  login(): FactoryAccount {
    if (this.loggingOut) throw new Error('FACTORY_ACCOUNT_BUSY');
    if (['starting', 'pending'].includes(this.snapshot.login.state)) return structuredClone(this.snapshot);
    const generation = ++this.generation;
    this.snapshot.login = { state: 'starting' };
    this.expires = setTimeout(
      () => {
        void this.cancel();
      },
      15 * 60 * 1000
    );
    void (async () => {
      try {
        await this.connect(generation);
        if (generation !== this.generation) return;
        await this.request('authenticate', { methodId: 'device-pairing' }, 15 * 60 * 1000);
        if (generation !== this.generation) return;
        this.snapshot.login = { state: 'succeeded' };
        this.checkedAt = 0;
        await this.status(true);
      } catch (error) {
        if (generation === this.generation) {
          this.snapshot.login = { state: 'failed' };
          this.snapshot.error = errorCode(error);
        }
      } finally {
        if (generation === this.generation) {
          clearTimeout(this.expires);
          await this.disconnect();
        }
      }
    })();
    return structuredClone(this.snapshot);
  }
  private async disconnect(): Promise<void> {
    const transport = this.transport;
    this.transport = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('FACTORY_AUTH_CANCELLED'));
    }
    this.pending.clear();
    await transport?.close();
  }
  async cancel(): Promise<FactoryAccount> {
    this.generation += 1;
    clearTimeout(this.expires);
    this.snapshot.login = { state: 'cancelled' };
    await this.disconnect();
    this.checkedAt = 0;
    return structuredClone(this.snapshot);
  }
  async logout(): Promise<FactoryAccount> {
    if (this.loggingOut) throw new Error('FACTORY_ACCOUNT_BUSY');
    this.loggingOut = true;
    try {
      await this.cancel();
      const generation = this.generation;
      await this.connect(generation);
      await this.request('logout', {});
      this.snapshot.authenticated = false;
      this.snapshot.login = { state: 'idle' };
      this.checkedAt = 0;
      return await this.status(true);
    } finally {
      await this.disconnect();
      this.loggingOut = false;
    }
  }
  async close(): Promise<void> {
    await this.cancel();
  }
}
