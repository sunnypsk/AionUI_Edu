import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createLease } from './leases.js';
import { isInstallId } from './store.js';
import { browserCodexLaunch, browserCodexSpawn } from '../../browser/launcher.js';
import { specialistCodexLaunch } from '../../droid/launcher.js';
import { audioCodexLaunch } from '../../../audio/launcher.js';
import { assertStartupHeadroom, readCgroupTasks, startupTaskReserve } from './resources.js';
export { readCgroupTasks } from './resources.js';

/** Keeps a per-process lease until the selected CLI exits; stdio remains the app-server transport. */
export async function launchCodex(args = process.argv.slice(2), env = process.env): Promise<number> {
  assertStartupHeadroom(await readCgroupTasks(), startupTaskReserve(env.AIONUI_CODEX_STARTUP_TASK_RESERVE));
  const root = env.AIONUI_CODEX_RUNTIME_ROOT;
  const lease = root ? await createLease(root) : undefined;
  let command = env.AIONUI_BUNDLED_CODEX;
  let versionId: string | undefined;
  try {
    if (root) {
      try {
        const directory = await realpath(path.join(root, 'current'));
        const versions = await realpath(path.join(root, 'versions'));
        const id = path.basename(directory);
        if (path.dirname(directory) !== versions || !isInstallId(id)) throw new Error('CODEX_CURRENT_PATH_CONFLICT');
        const managed = path.join(directory, 'node_modules', '.bin', 'codex');
        await access(managed);
        command = managed;
        versionId = id;
        await lease!.update(id, null);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (!command) throw new Error('CODEX_BUNDLED_PATH_REQUIRED');
    const browser = browserCodexLaunch(args, { ...env, TOKIO_WORKER_THREADS: env.TOKIO_WORKER_THREADS || '4' });
    const specialists = specialistCodexLaunch(browser.args, browser.env);
    const audio = audioCodexLaunch(specialists.args, specialists.env);
    const executable = browserCodexSpawn(command, { ...browser, ...specialists, ...audio });
    const child = spawn(executable.command, executable.args, { env: audio.env, stdio: 'inherit' });
    const handlers = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((signal) => {
      const handler = (): void => {
        child.kill(signal);
      };
      process.on(signal, handler);
      return { signal, handler };
    });
    try {
      const result = new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve(code ?? 128 + (signal ? osConstants.signals[signal] : 0)));
      });
      // Register rejection immediately, including a spawn failure during the lease write.
      void result.catch(() => {});
      if (lease && versionId && child.pid) {
        try {
          await lease.update(versionId, child.pid);
        } catch (error) {
          child.kill('SIGTERM');
          await result;
          throw error;
        }
      } else {
        // Bundled files are immutable and are never cleanup candidates.
        await lease?.release();
      }
      return await result;
    } finally {
      for (const { signal, handler } of handlers) process.removeListener(signal, handler);
    }
  } finally {
    await lease?.release();
  }
}
