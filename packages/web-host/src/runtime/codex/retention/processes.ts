import { execFile } from 'node:child_process';
import { readFile, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { isInstallId } from './store.js';

const execFileAsync = promisify(execFile);
export type Usage = { ids: Set<string>; complete: boolean };

/** Extracts managed installation paths without returning command lines or credentials to the UI. */
export function findUsedVersions(text: string, root: string): Set<string> {
  const prefix = path.join(root, 'versions') + path.sep;
  const ids = new Set<string>();
  for (const segment of text.split(prefix).slice(1)) {
    const id = segment.split('\0', 1)[0].split(/[\s/]/, 1)[0];
    if (isInstallId(id)) ids.add(id);
  }
  return ids;
}

/** Covers orphaned native processes and invocations that did not originate in the WebUI launcher. */
export async function inspectProcesses(root: string, platform = process.platform, procRoot = '/proc'): Promise<Usage> {
  const ids = new Set<string>();
  try {
    if (platform === 'darwin') {
      const result = await execFileAsync('/bin/ps', ['-ww', '-axo', 'pid=,comm=,args='], {
        timeout: 3000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return { ids: findUsedVersions(result.stdout, root), complete: true };
    }
    if (platform !== 'linux') return { ids, complete: false };
    let complete = true;
    for (const pid of (await readdir(procRoot)).filter((name) => /^\d+$/.test(name))) {
      try {
        const directory = path.join(procRoot, pid);
        const comm = (await readFile(path.join(directory, 'comm'), 'utf8')).trim();
        if (!/^(codex|node|bun)(?:$|[-.])/.test(comm)) continue;
        const [executable, args] = await Promise.all([
          readlink(path.join(directory, 'exe')),
          readFile(path.join(directory, 'cmdline'), 'utf8'),
        ]);
        for (const id of findUsedVersions(`${executable}\0${args}`, root)) ids.add(id);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ESRCH')
          complete = false;
      }
    }
    return { ids, complete };
  } catch {
    return { ids, complete: false };
  }
}
