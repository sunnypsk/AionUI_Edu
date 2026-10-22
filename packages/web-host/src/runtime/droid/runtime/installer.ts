import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, open, rename, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { valid, prerelease } from 'semver';
import type { DroidExecutable } from './executable.js';

const execute = promisify(execFile);
const LIMIT = 512 * 1024 * 1024;
type Phase = 'downloading' | 'verifying';
type Verify = (binary: string, signal: AbortSignal) => Promise<void>;

/** Download a complete, checksum-verified official release before atomic activation. */
export class DroidInstaller {
  constructor(
    private readonly runtime: DroidExecutable,
    private readonly request: typeof fetch = fetch,
    private readonly platform: string = process.platform,
    private readonly arch: string = process.arch
  ) {}
  get available(): boolean {
    return this.runtime.available;
  }

  async install(version: string, signal: AbortSignal, onPhase: (phase: Phase) => void, verify: Verify): Promise<void> {
    if (!this.available) throw new Error('FACTORY_UPDATE_UNSUPPORTED');
    if (!valid(version) || prerelease(version)) throw new Error('FACTORY_VERSION_INVALID');
    const versions = path.join(this.runtime.root, 'versions');
    await mkdir(versions, { recursive: true, mode: 0o700 });
    const candidate = await mkdtemp(path.join(versions, '.candidate-'));
    const link = path.join(this.runtime.root, `.activate-${randomUUID()}`);
    let completed: string | undefined;
    let activated = false;
    try {
      onPhase('downloading');
      const url = `https://downloads.factory.ai/factory-cli/releases/${version}/${this.platform}/${this.arch === 'x64' ? 'x64-baseline' : this.arch}/droid`;
      const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(300000)]);
      const checksum = await this.request(`${url}.sha256`, { redirect: 'error', signal: downloadSignal });
      if (!checksum.ok) throw new Error('FACTORY_DOWNLOAD_FAILED');
      const expected = (await checksum.text()).trim();
      if (!/^[a-fA-F0-9]{64}$/.test(expected)) throw new Error('FACTORY_CHECKSUM_INVALID');
      const response = await this.request(url, { redirect: 'error', signal: downloadSignal });
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > LIMIT)
        throw new Error('FACTORY_DOWNLOAD_FAILED');
      const binary = path.join(candidate, 'droid');
      const file = await open(binary, 'wx', 0o700);
      const reader = response.body.getReader();
      const hash = createHash('sha256');
      let size = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > LIMIT) throw new Error('FACTORY_DOWNLOAD_FAILED');
          hash.update(value);
          await file.writeFile(value);
        }
        await file.sync();
      } finally {
        await reader.cancel().catch(() => {});
        await file.close();
      }
      if (!size || hash.digest('hex') !== expected.toLowerCase()) throw new Error('FACTORY_CHECKSUM_INVALID');
      onPhase('verifying');
      await chmod(binary, 0o700);
      const result = await execute(binary, ['--version'], {
        signal,
        timeout: 10000,
        maxBuffer: 16384,
        cwd: candidate,
        env: {
          PATH: process.env.PATH,
          HOME: candidate,
          USERPROFILE: candidate,
          FACTORY_HOME_OVERRIDE: candidate,
          FACTORY_DISABLE_KEYRING: 'true',
          FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false',
          FACTORYD_DISABLE_AUTO_UPDATE: '1',
        },
      });
      if (result.stdout.trim() !== version) throw new Error('FACTORY_VERSION_MISMATCH');
      await verify(binary, signal);
      signal.throwIfAborted();
      const current = path.join(this.runtime.root, 'current');
      const existing = await lstat(current).catch((error: NodeJS.ErrnoException): null => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (existing && !existing.isSymbolicLink()) throw new Error('FACTORY_RUNTIME_PATH_INVALID');
      completed = path.join(versions, `${version}-${randomUUID()}`);
      await rename(candidate, completed);
      await symlink(path.relative(this.runtime.root, completed), link);
      signal.throwIfAborted();
      await rename(link, current);
      activated = true;
    } finally {
      await rm(link, { force: true });
      await rm(candidate, { recursive: true, force: true });
      if (completed && !activated) await rm(completed, { recursive: true, force: true });
    }
  }
}
