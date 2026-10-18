import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isInstallId, isPlainDirectory } from './store.js';
import { inspectProcesses, type Usage } from './processes.js';

type Lease = { launcherPid: number; childPid: number | null; versionId: string | null };
const LEASE_PATTERN = /^\d+-[a-f0-9-]{36}\.json$/;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** Places a starting guard before reading current, so cleanup cannot miss a delayed launcher. */
export async function createLease(root: string) {
  const directory = path.join(root, 'leases');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await isPlainDirectory(directory))) throw new Error('CODEX_LEASE_PATH_CONFLICT');
  const file = path.join(directory, `${process.pid}-${randomUUID()}.json`);
  const lease: Lease = { launcherPid: process.pid, childPid: null, versionId: null };
  await writeFile(file, JSON.stringify(lease), { flag: 'wx', mode: 0o600 });
  return {
    async update(versionId: string, childPid: number | null): Promise<void> {
      await writeFile(file, JSON.stringify({ ...lease, versionId, childPid }));
    },
    async release(): Promise<void> {
      await rm(file, { force: true });
    },
  };
}

/** A failed or incomplete inspection blocks deletion; PID reuse only retains extra versions. */
export async function readUsage(root: string): Promise<Usage> {
  let usage: Usage;
  try {
    usage = await inspectProcesses(await realpath(root));
  } catch {
    return { ids: new Set<string>(), complete: false };
  }
  try {
    const directory = path.join(root, 'leases');
    if (!(await isPlainDirectory(directory))) return { ...usage, complete: false };
    for (const name of await readdir(directory)) {
      if (!LEASE_PATTERN.test(name)) return { ...usage, complete: false };
      try {
        const file = path.join(directory, name);
        if (!(await lstat(file)).isFile()) return { ...usage, complete: false };
        const lease = JSON.parse(await readFile(file, 'utf8')) as Lease;
        if (
          !Number.isSafeInteger(lease.launcherPid) ||
          lease.launcherPid < 1 ||
          (lease.childPid !== null && (!Number.isSafeInteger(lease.childPid) || lease.childPid < 1)) ||
          (lease.versionId !== null && (typeof lease.versionId !== 'string' || !isInstallId(lease.versionId)))
        )
          return { ...usage, complete: false };
        if (isAlive(lease.launcherPid) || (lease.childPid !== null && isAlive(lease.childPid))) {
          if (lease.versionId === null) usage.complete = false;
          else usage.ids.add(lease.versionId);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') usage.complete = false;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') usage.complete = false;
  }
  return usage;
}
