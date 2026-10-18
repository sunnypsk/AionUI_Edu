import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { CodexAccountStatus } from '../types.js';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type RpcMessage = { id?: number; result?: unknown; error?: unknown; method?: string; params?: Record<string, unknown> };
type LoginResult = { type: string; loginId: string; verificationUrl: string; userCode: string };
export type AuthProcessFactory = () => ChildProcessWithoutNullStreams;

/** Dedicated account-only app-server client. It never starts a thread or sends a prompt. */
export class CodexAuthService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private sequence = 0;
  private pending = new Map<number, PendingRequest>();
  private login: CodexAccountStatus['login'] = { state: 'idle' };
  private loginId: string | null = null;
  private loginRequest: Promise<CodexAccountStatus> | null = null;
  private loginGeneration = 0;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private authenticated = false;
  private email: string | undefined;
  private authType: string | undefined;

  constructor(private readonly processFactory?: AuthProcessFactory) {}

  private async ensureClient(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.startClient();
    try {
      await this.ready;
    } catch {
      this.close();
      throw new Error('CODEX_AUTH_UNAVAILABLE');
    }
  }

  private async startClient(): Promise<void> {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    if (!this.processFactory) await mkdir(codexHome, { recursive: true, mode: 0o700 });
    const child = this.processFactory
      ? this.processFactory()
      : spawn('codex', ['app-server', '--listen', 'stdio://', '-c', 'cli_auth_credentials_store="file"'], {
          cwd: os.tmpdir(),
          env: { ...process.env, CODEX_HOME: codexHome },
          stdio: 'pipe',
        });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let message: RpcMessage;
      try {
        message = JSON.parse(line) as RpcMessage;
      } catch {
        return;
      }
      if (typeof message.id === 'number') {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error('CODEX_AUTH_FAILED'));
        else request.resolve(message.result);
      } else if (message.method === 'account/login/completed' && message.params?.loginId === this.loginId) {
        if (this.expiry) clearTimeout(this.expiry);
        this.expiry = null;
        this.loginId = null;
        this.login = { state: message.params.success ? 'succeeded' : 'failed' };
      }
    });
    // Drain diagnostics without logging tokens, device codes, or OAuth responses.
    child.stderr.resume();
    const failed = () => {
      if (this.child !== child) return;
      if (['starting', 'pending'].includes(this.login.state)) this.login = { state: 'failed' };
      this.child = null;
      this.ready = null;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('CODEX_AUTH_UNAVAILABLE'));
      }
      this.pending.clear();
      lines.close();
    };
    child.once('error', failed);
    child.once('exit', failed);
    child.stdin.on('error', failed);
    await this.request('initialize', {
      clientInfo: { name: 'aionui_edu_auth', title: 'AionUI_Edu', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    this.child?.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.child) {
        reject(new Error('CODEX_AUTH_UNAVAILABLE'));
        return;
      }
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CODEX_AUTH_TIMEOUT'));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error('CODEX_AUTH_UNAVAILABLE'));
        }
      });
    });
  }

  private snapshot(): CodexAccountStatus {
    return {
      authenticated: this.authenticated,
      ...(this.email ? { email: this.email } : {}),
      ...(this.authType ? { authType: this.authType } : {}),
      login: { ...this.login },
    };
  }

  async status(): Promise<CodexAccountStatus> {
    await this.ensureClient();
    const result = (await this.request('account/read', { refreshToken: false })) as {
      account?: { type?: string; email?: string } | null;
    };
    this.authenticated = Boolean(result.account);
    this.email = typeof result.account?.email === 'string' ? result.account.email : undefined;
    this.authType = typeof result.account?.type === 'string' ? result.account.type : undefined;
    return this.snapshot();
  }

  startLogin(): Promise<CodexAccountStatus> {
    if (this.loginRequest) return this.loginRequest;
    if (this.login.state === 'pending') return Promise.resolve(this.snapshot());
    this.loginRequest = this.beginLogin().finally(() => {
      this.loginRequest = null;
    });
    return this.loginRequest;
  }

  private async beginLogin(): Promise<CodexAccountStatus> {
    const generation = ++this.loginGeneration;
    this.login = { state: 'starting' };
    try {
      await this.ensureClient();
      const result = (await this.request('account/login/start', { type: 'chatgptDeviceCode' })) as LoginResult;
      if (generation !== this.loginGeneration) {
        if (result.loginId && this.child) await this.request('account/login/cancel', { loginId: result.loginId });
        return this.snapshot();
      }
      const verificationUrl = new URL(result.verificationUrl);
      if (
        result.type !== 'chatgptDeviceCode' ||
        verificationUrl.protocol !== 'https:' ||
        !['auth.openai.com', 'chatgpt.com'].includes(verificationUrl.hostname) ||
        !result.loginId ||
        !result.userCode
      )
        throw new Error('CODEX_AUTH_FAILED');
      this.loginId = result.loginId;
      this.login = { state: 'pending', verificationUrl: verificationUrl.href, userCode: result.userCode };
      this.expiry = setTimeout(() => {
        void this.cancelLogin('expired').catch(() => {
          /* The code is already cleared, even if the CLI has stopped. */
        });
      }, 15 * 60_000);
      return this.snapshot();
    } catch {
      if (generation === this.loginGeneration) this.login = { state: 'failed' };
      throw new Error('CODEX_AUTH_FAILED');
    }
  }

  async cancelLogin(state: 'cancelled' | 'expired' = 'cancelled'): Promise<CodexAccountStatus> {
    this.loginGeneration += 1;
    const loginId = this.loginId;
    this.loginId = null;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    this.login = { state };
    if (loginId && this.child) await this.request('account/login/cancel', { loginId });
    return this.snapshot();
  }

  async logout(): Promise<CodexAccountStatus> {
    await this.cancelLogin();
    await this.ensureClient();
    await this.request('account/logout', {});
    this.authenticated = false;
    this.email = undefined;
    this.authType = undefined;
    this.login = { state: 'idle' };
    return this.snapshot();
  }

  close(): void {
    this.loginGeneration += 1;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('CODEX_AUTH_UNAVAILABLE'));
    }
    this.pending.clear();
    const child = this.child;
    this.child = null;
    this.ready = null;
    child?.stdin.end();
    child?.kill();
  }
}
