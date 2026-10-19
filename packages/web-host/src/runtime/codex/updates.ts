import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gt, prerelease, valid } from 'semver';
import type { CodexUpdateStatus, CodexInstallStatus, CodexVersionInventory, CodexCleanupResult } from '../../types.js';
import type { CodexInstaller } from './installer.js';
import type { CodexRetention } from './retention/index.js';

const execFileAsync = promisify(execFile);
const REGISTRY_URL = 'https://registry.npmjs.org/@openai%2fcodex/latest';
const CHECK_INTERVAL_MS = 60_000;

/**
 * Mirrors VERIFIED_CODEX_VERSION in `crates/aionui-session/src/backend/cli_version.rs` of the AionCore commit
 * pinned by packages/web-host/openui/core/upstream.json. Update it whenever that pin changes.
 */
export const VERIFIED_CODEX_VERSION = '0.151.0';

async function readInstalledVersion(): Promise<string> {
  const { stdout } = await execFileAsync('codex', ['--version'], { timeout: 5000, maxBuffer: 4096 });
  const version = stdout.trim().match(/^codex-cli (\S+)$/)?.[1];
  if (!version || !valid(version)) throw new Error('CODEX_VERSION_UNAVAILABLE');
  return version;
}

async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(REGISTRY_URL, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('CODEX_UPDATE_CHECK_FAILED');
  const metadata: unknown = await response.json();
  const version = metadata && typeof metadata === 'object' && 'version' in metadata ? metadata.version : null;
  if (typeof version !== 'string' || !valid(version) || prerelease(version))
    throw new Error('CODEX_UPDATE_CHECK_FAILED');
  return version;
}

/** Checks the official stable release and coordinates one persistent CLI update at a time. */
export class CodexUpdateService {
  private latestVersion: string | null = null;
  private checkedAt: string | null = null;
  private pending: Promise<CodexUpdateStatus> | null = null;
  private installation: CodexInstallStatus = { phase: 'idle', targetVersion: null };
  private installTask: Promise<void> | null = null;
  private installAbort: AbortController | null = null;
  private cleaning = false;

  constructor(
    private readonly readVersion = readInstalledVersion,
    private readonly fetchLatest = fetchLatestVersion,
    private readonly now = () => new Date(),
    private readonly installer?: Pick<CodexInstaller, 'available' | 'install'>,
    private readonly retention?: Pick<CodexRetention, 'inventory' | 'cleanup'>
  ) {}

  private snapshot(installedVersion: string): CodexUpdateStatus {
    if (!valid(installedVersion)) throw new Error('CODEX_VERSION_UNAVAILABLE');
    return {
      installedVersion,
      verifiedVersion: VERIFIED_CODEX_VERSION,
      latestVersion: this.latestVersion,
      checkedAt: this.checkedAt,
      updateAvailable: this.latestVersion === null ? null : gt(this.latestVersion, installedVersion),
      canInstall: this.installer?.available ?? false,
      installation: { ...this.installation },
    };
  }

  /** Reads the installed CLI without contacting the registry. */
  async status(): Promise<CodexUpdateStatus> {
    return this.snapshot(await this.readVersion());
  }

  /** Coalesces concurrent checks and reuses a successful result for one minute. */
  check(): Promise<CodexUpdateStatus> {
    if (this.pending) return this.pending;
    if (this.checkedAt && this.now().getTime() - Date.parse(this.checkedAt) < CHECK_INTERVAL_MS) return this.status();
    this.pending = this.runCheck().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async runCheck(): Promise<CodexUpdateStatus> {
    const [installedVersion, latestVersion] = await Promise.all([this.readVersion(), this.fetchLatest()]);
    if (!valid(installedVersion) || !valid(latestVersion) || prerelease(latestVersion))
      throw new Error('CODEX_UPDATE_CHECK_FAILED');
    this.latestVersion = latestVersion;
    this.checkedAt = this.now().toISOString();
    return this.snapshot(installedVersion);
  }

  /** Queues a stable-release update; callers poll status rather than hold an HTTP connection open. */
  async install(): Promise<CodexUpdateStatus> {
    if (this.cleaning) throw new Error('CODEX_RUNTIME_BUSY');
    if (!this.installer?.available) throw new Error('CODEX_UPDATE_UNSUPPORTED');
    if (!this.installTask) {
      this.installAbort = new AbortController();
      this.installation = { phase: 'checking', targetVersion: null };
      this.installTask = this.runInstall(this.installAbort.signal).finally(() => {
        this.installTask = null;
        this.installAbort = null;
      });
    }
    return this.status();
  }

  /** Reports deletion eligibility without selecting or removing anything. */
  async versions(): Promise<CodexVersionInventory> {
    const bundled = await this.readVersion().catch((): null => null);
    return (
      (await this.retention?.inventory(!!this.installTask || this.cleaning, bundled)) ?? {
        versions: [],
        supported: false,
        inspectionComplete: false,
        busy: false,
      }
    );
  }

  /** Serializes manual cleanup with update jobs so activation cannot change during deletion. */
  async cleanup(ids: string[]): Promise<CodexCleanupResult> {
    if (this.installTask || this.cleaning) throw new Error('CODEX_RUNTIME_BUSY');
    if (!this.retention) throw new Error('CODEX_UPDATE_UNSUPPORTED');
    this.cleaning = true;
    try {
      return await this.retention.cleanup(ids);
    } finally {
      this.cleaning = false;
    }
  }

  private async runInstall(signal: AbortSignal): Promise<void> {
    try {
      // Resolve the official stable version again when installing, even if the UI check is old.
      const status = await this.runCheck();
      signal.throwIfAborted();
      this.installation.targetVersion = status.latestVersion;
      if (status.updateAvailable && status.latestVersion) {
        await this.installer!.install(status.latestVersion, signal, (phase) => {
          this.installation.phase = phase;
        });
        const installed = await this.readVersion();
        if (installed !== status.latestVersion) throw new Error('CODEX_UPDATE_FAILED');
      }
      this.installation.phase = 'succeeded';
    } catch {
      this.installation.phase = 'failed';
    }
  }

  /** Aborts this host's update without stopping any conversation's CLI process. */
  close(): void {
    this.installAbort?.abort();
  }
}
