import { lstat, readdir, readlink, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { rcompare } from 'semver';
import type { CodexCleanupResult, CodexVersionInventory } from '../../../types.js';
import { readUsage } from './leases.js';
import { isInstallId, isPlainDirectory, readInstallRecord } from './store.js';

export { isInstallId, writeInstallRecord } from './store.js';
export { launchCodex } from './launcher.js';

/** Lists and removes only validated updater-owned installations under the fixed runtime root. */
export class CodexRetention {
  readonly root: string;
  readonly available: boolean;

  constructor(
    dataDir: string,
    private readonly inspect = readUsage
  ) {
    this.root = path.join(dataDir, 'runtime', 'codex-cli');
    this.available =
      ['linux', 'darwin'].includes(process.platform) && process.env.AIONUI_CODEX_RUNTIME_ROOT === this.root;
  }

  /** Keeps the newest two installations, the selected default, and all active or unknown versions. */
  async inventory(busy = false, bundledVersion?: string | null): Promise<CodexVersionInventory> {
    const inventory = await this.scan(busy);
    // The image-bundled CLI lives outside versions/; list it (never removable) while no managed install is selected.
    if (inventory.supported && bundledVersion && !inventory.versions.some((entry) => entry.protection === 'selected'))
      inventory.versions.push({
        id: 'bundled',
        version: bundledVersion,
        installedAt: null,
        protection: 'bundled',
        removable: false,
      });
    return inventory;
  }

  private async scan(busy: boolean): Promise<CodexVersionInventory> {
    const result: CodexVersionInventory = { versions: [], inspectionComplete: true, supported: this.available, busy };
    if (!this.available) return result;
    try {
      const versions = path.join(this.root, 'versions');
      if (!(await isPlainDirectory(this.root)) || !(await isPlainDirectory(versions)))
        return { ...result, inspectionComplete: false };
      let selected: string | null = null;
      try {
        const current = path.join(this.root, 'current');
        if (!(await lstat(current)).isSymbolicLink()) return { ...result, inspectionComplete: false };
        const target = path.resolve(this.root, await readlink(current));
        if (path.dirname(target) !== versions || !isInstallId(path.basename(target)))
          return { ...result, inspectionComplete: false };
        selected = path.basename(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      for (const id of (await readdir(versions)).filter((name) => !name.startsWith('.'))) {
        const record = await readInstallRecord(path.join(versions, id), id);
        result.versions.push({
          id,
          version: record?.version ?? null,
          installedAt: record?.installedAt ?? null,
          protection: record ? null : 'unverified',
          removable: false,
        });
      }
      result.versions.sort((a, b) => {
        if (!a.version || !b.version) return a.version ? -1 : b.version ? 1 : a.id.localeCompare(b.id);
        return rcompare(a.version, b.version) || (b.installedAt ?? '').localeCompare(a.installedAt ?? '');
      });
      const retained = result.versions.filter((entry) => entry.protection !== 'unverified').slice(0, 2);
      const usage = await this.inspect(await realpath(this.root));
      result.inspectionComplete = usage.complete;
      for (const entry of result.versions) {
        if (entry.protection === 'unverified') continue;
        entry.protection =
          entry.id === selected
            ? 'selected'
            : entry.id === retained[0]?.id
              ? 'latest'
              : entry.id === retained[1]?.id
                ? 'previous'
                : usage.ids.has(entry.id)
                  ? 'inUse'
                  : null;
        entry.removable = !entry.protection && usage.complete && !busy;
      }
      return result;
    } catch (error) {
      return {
        ...result,
        versions: result.versions.map((entry) => ({ ...entry, removable: false })),
        inspectionComplete: !result.versions.length && (error as NodeJS.ErrnoException).code === 'ENOENT',
      };
    }
  }

  /** Revalidates current retention and process usage instead of trusting a stale browser selection. */
  async cleanup(ids: string[]): Promise<CodexCleanupResult> {
    if (!this.available) throw new Error('CODEX_UPDATE_UNSUPPORTED');
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 64 ||
      ids.some((id) => typeof id !== 'string' || !isInstallId(id))
    )
      throw new Error('INVALID_REQUEST');
    const inventory = await this.scan(false);
    const removable = new Set(inventory.versions.filter((entry) => entry.removable).map((entry) => entry.id));
    const removed: string[] = [];
    const retained: string[] = [];
    for (const id of new Set(ids)) {
      const directory = path.join(this.root, 'versions', id);
      if (!removable.has(id) || !(await readInstallRecord(directory, id))) {
        retained.push(id);
        continue;
      }
      await rm(directory, { recursive: true });
      removed.push(id);
    }
    return { removed, retained, inventory: await this.scan(false) };
  }
}
