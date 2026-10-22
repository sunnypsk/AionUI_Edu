import { access, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Resolve one immutable executable before a process starts; never overwrite a running binary. */
export class DroidExecutable {
  readonly root: string;
  readonly available: boolean;
  constructor(
    dataDir: string,
    private readonly override = process.env.AIONUI_DROID_BIN,
    private readonly bundled = process.env.AIONUI_BUNDLED_DROID || 'droid',
    supported = ['linux', 'darwin'].includes(process.platform) && ['x64', 'arm64'].includes(process.arch)
  ) {
    this.root = path.join(dataDir, 'runtime', 'droid-cli');
    this.available = supported && !override;
  }
  async resolve(): Promise<string> {
    if (this.override) return this.override;
    try {
      const directory = await realpath(path.join(this.root, 'current'));
      const versions = await realpath(path.join(this.root, 'versions'));
      if (path.dirname(directory) !== versions) throw new Error('SPECIALIST_RUNTIME_PATH_INVALID');
      const executable = path.join(directory, 'droid');
      await access(executable);
      return executable;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return this.bundled;
    }
  }
}
