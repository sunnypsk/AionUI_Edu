import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { prerelease, valid } from 'semver';
import { writeInstallRecord } from './retention/index.js';

const execFileAsync = promisify(execFile);
const REQUIRED_METHODS = [
  'initialize',
  'thread/start',
  'thread/resume',
  'thread/settings/update',
  'permissionProfile/list',
  'turn/start',
  'turn/interrupt',
  'account/read',
  'model/list',
];
type InstallPhase = 'downloading' | 'verifying';
type Execute = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    signal: AbortSignal;
    timeout: number;
    env: NodeJS.ProcessEnv;
  }
) => Promise<{ stdout: string }>;

/** Checks the public app-server contract without loading an account or starting a conversation. */
export function assertCodexProtocol(schema: unknown): void {
  const methods = new Set<string>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    const properties = object.properties as { method?: { enum?: unknown[] } } | undefined;
    for (const method of properties?.method?.enum ?? []) if (typeof method === 'string') methods.add(method);
    for (const child of Object.values(object)) walk(child);
  };
  walk(schema);
  if (REQUIRED_METHODS.some((method) => !methods.has(method))) throw new Error('CODEX_PROTOCOL_INCOMPATIBLE');
}

/** Installs official npm packages as the app user and activates only a validated, complete version. */
export class CodexInstaller {
  readonly root: string;
  readonly available: boolean;

  constructor(
    dataDir: string,
    private readonly execute: Execute = (command, args, options) =>
      execFileAsync(command, args, { ...options, maxBuffer: 128 * 1024 }),
    supported = ['linux', 'darwin'].includes(process.platform) && ['x64', 'arm64'].includes(process.arch)
  ) {
    this.root = path.join(dataDir, 'runtime', 'codex-cli');
    // The stable launcher must be installed by the host before self-service updates can work.
    this.available = supported && process.env.AIONUI_CODEX_RUNTIME_ROOT === this.root;
  }

  async install(version: string, signal: AbortSignal, onPhase: (phase: InstallPhase) => void): Promise<void> {
    if (!valid(version) || prerelease(version)) throw new Error('INVALID_CODEX_VERSION');
    const versions = path.join(this.root, 'versions');
    await mkdir(versions, { recursive: true, mode: 0o700 });
    const candidate = await mkdtemp(path.join(versions, '.candidate-'));
    const link = path.join(this.root, `.activate-${randomUUID()}`);
    let completed: string | undefined;
    let activated = false;
    try {
      signal.throwIfAborted();
      onPhase('downloading');
      const userConfig = path.join(candidate, '.npm-userconfig');
      const globalConfig = path.join(candidate, '.npm-globalconfig');
      await Promise.all([writeFile(userConfig, ''), writeFile(globalConfig, '')]);
      // npm verifies package integrity. Fixed registry, exact version and disabled scripts avoid arbitrary installers.
      await this.execute(
        'npm',
        [
          'install',
          '--prefix',
          candidate,
          '--registry=https://registry.npmjs.org',
          `--userconfig=${userConfig}`,
          `--globalconfig=${globalConfig}`,
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--no-progress',
          '--cache',
          path.join(candidate, '.npm-cache'),
          `@openai/codex@${version}`,
        ],
        { cwd: candidate, signal, timeout: 5 * 60_000, env: process.env }
      );
      signal.throwIfAborted();
      onPhase('verifying');
      const cli = path.join(candidate, 'node_modules', '.bin', 'codex');
      const probeHome = path.join(candidate, '.probe-home');
      await mkdir(probeHome, { mode: 0o700 });
      const options = { cwd: candidate, signal, timeout: 30_000, env: { ...process.env, CODEX_HOME: probeHome } };
      const result = await this.execute(cli, ['--version'], options);
      if (result.stdout.trim() !== `codex-cli ${version}`) throw new Error('CODEX_VERSION_MISMATCH');
      const schemaDir = path.join(candidate, '.probe-schema');
      await this.execute(cli, ['app-server', 'generate-json-schema', '--experimental', '--out', schemaDir], options);
      assertCodexProtocol(JSON.parse(await readFile(path.join(schemaDir, 'ClientRequest.json'), 'utf8')));
      await rm(schemaDir, { recursive: true, force: true });
      await rm(probeHome, { recursive: true, force: true });
      await rm(path.join(candidate, '.npm-cache'), { recursive: true, force: true });
      await Promise.all([rm(userConfig), rm(globalConfig)]);
      signal.throwIfAborted();
      const current = path.join(this.root, 'current');
      const existing = await lstat(current).catch((error: NodeJS.ErrnoException): null => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (existing && !existing.isSymbolicLink()) throw new Error('CODEX_CURRENT_PATH_CONFLICT');
      const id = `${version}-${randomUUID()}`;
      await writeInstallRecord(candidate, { id, version, installedAt: new Date().toISOString() });
      completed = path.join(versions, id);
      await rename(candidate, completed);
      await symlink(path.relative(this.root, completed), link);
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
