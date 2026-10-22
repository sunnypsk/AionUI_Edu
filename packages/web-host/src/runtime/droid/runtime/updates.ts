import { gt, valid, prerelease } from 'semver';
import type { FactoryProvider } from '../provider/sdk.js';
import { DroidInstaller } from './installer.js';
import { verifyDroidCandidate } from './verify.js';
import { errorCode } from '../types.js';
import type { DroidUpdateStatus } from '../../../../../desktop/src/common/types/platform/specialists.js';

/** Read only the official package's stable tag; never execute a remote installer script. */
export async function latestDroidVersion(): Promise<string> {
  const response = await fetch('https://registry.npmjs.org/droid/latest', {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('FACTORY_UPDATE_CHECK_FAILED');
  const result = (await response.json()) as { name?: unknown; version?: unknown };
  if (
    result.name !== 'droid' ||
    typeof result.version !== 'string' ||
    !valid(result.version) ||
    prerelease(result.version)
  )
    throw new Error('FACTORY_UPDATE_CHECK_FAILED');
  return result.version;
}

/** One update per instance; preferences and credentials remain owner-scoped. */
export class DroidUpdateService {
  private latest: string | null = null;
  private checkedAt: string | null = null;
  private checking?: Promise<DroidUpdateStatus>;
  private installation: DroidUpdateStatus['installation'] = { phase: 'idle', targetVersion: null };
  private controller?: AbortController;
  private job?: Promise<void>;
  constructor(
    private readonly provider: FactoryProvider,
    private readonly installer = new DroidInstaller(provider.runtime),
    private readonly fetchLatest = latestDroidVersion,
    private readonly verify = verifyDroidCandidate
  ) {}
  async status(): Promise<DroidUpdateStatus> {
    const installedVersion = await this.provider.version().catch((): null => null);
    return {
      installedVersion,
      latestVersion: this.latest,
      checkedAt: this.checkedAt,
      updateAvailable: this.latest === null ? null : installedVersion === null || gt(this.latest, installedVersion),
      canInstall: this.installer.available,
      installation: { ...this.installation },
    };
  }
  check(force = false): Promise<DroidUpdateStatus> {
    if (this.checking) return this.checking;
    if (!force && this.checkedAt && Date.now() - Date.parse(this.checkedAt) < 60000) return this.status();
    this.checking = this.fetchLatest()
      .then(async (version) => {
        if (!valid(version) || prerelease(version)) throw new Error('FACTORY_UPDATE_CHECK_FAILED');
        this.latest = version;
        this.checkedAt = new Date().toISOString();
        return this.status();
      })
      .finally(() => {
        this.checking = undefined;
      });
    return this.checking;
  }
  async install(userId: string): Promise<DroidUpdateStatus> {
    if (!this.installer.available) throw new Error('FACTORY_UPDATE_UNSUPPORTED');
    if (!this.job) {
      const controller = new AbortController();
      this.controller = controller;
      this.installation = { phase: 'checking', targetVersion: null };
      this.job = this.run(userId, controller.signal).finally(() => {
        this.job = undefined;
        this.controller = undefined;
      });
    }
    return this.status();
  }
  private async run(userId: string, signal: AbortSignal): Promise<void> {
    try {
      const status = await this.check(true);
      signal.throwIfAborted();
      this.installation.targetVersion = status.latestVersion;
      if (status.updateAvailable && status.latestVersion) {
        const settings = await this.provider.preferences.get(userId);
        await this.installer.install(
          status.latestVersion,
          signal,
          (phase) => {
            this.installation.phase = phase;
          },
          (binary, abort) => this.verify(binary, settings, abort)
        );
        this.provider.invalidate();
      }
      this.installation.phase = 'succeeded';
    } catch (error) {
      this.installation.phase = 'failed';
      this.installation.error = errorCode(error);
    }
  }
  async close(): Promise<void> {
    this.controller?.abort();
    await this.job;
  }
}
