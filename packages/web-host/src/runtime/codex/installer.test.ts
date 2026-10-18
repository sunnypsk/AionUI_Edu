import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertCodexProtocol, CodexInstaller } from './installer.js';

const execFileAsync = promisify(execFile);
const schema = {
  oneOf: [
    'initialize',
    'thread/start',
    'thread/resume',
    'thread/settings/update',
    'permissionProfile/list',
    'turn/start',
    'turn/interrupt',
    'account/read',
    'model/list',
  ].map((method) => ({ properties: { method: { enum: [method] } } })),
};

describe.skipIf(process.platform === 'win32')('persistent Codex CLI installation', () => {
  let data: string;
  let root: string;
  let previous: string;
  const execute = vi.fn();

  beforeEach(async () => {
    data = await mkdtemp(path.join(os.tmpdir(), 'codex-install-test-'));
    root = path.join(data, 'runtime', 'codex-cli');
    previous = path.join(root, 'versions', 'previous');
    await mkdir(previous, { recursive: true });
    await writeFile(path.join(previous, 'keep'), 'existing CLI files');
    await symlink('versions/previous', path.join(root, 'current'));
    vi.stubEnv('AIONUI_CODEX_RUNTIME_ROOT', root);
    execute.mockReset();
    execute.mockImplementation(async (_command: string, args: string[], options: { cwd: string }) => {
      if (args[0] === 'install') {
        const bin = path.join(options.cwd, 'node_modules', '.bin');
        await mkdir(bin, { recursive: true });
        await writeFile(path.join(bin, 'codex'), '#!/bin/sh\nprintf "codex-cli 0.164.0\\n"\n');
        await chmod(path.join(bin, 'codex'), 0o755);
      }
      if (args[0] === 'app-server') {
        const output = args.at(-1)!;
        await mkdir(output);
        await writeFile(path.join(output, 'ClientRequest.json'), JSON.stringify(schema));
      }
      return { stdout: args[0] === '--version' ? 'codex-cli 0.164.0\n' : '' };
    });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(data, { recursive: true, force: true });
  });

  it('activates a validated installation and retains files needed by older running sessions', async () => {
    const installer = new CodexInstaller(data, execute);
    await installer.install('0.164.0', new AbortController().signal, vi.fn());
    const selected = await readlink(path.join(root, 'current'));
    expect(selected).toMatch(/^versions\/0\.164\.0-/);
    expect(await readFile(path.join(previous, 'keep'), 'utf8')).toBe('existing CLI files');
    expect((await readdir(path.join(root, selected))).includes('.probe-home')).toBe(false);
  });

  it('uses a fixed registry, exact package version and disabled lifecycle scripts', async () => {
    await new CodexInstaller(data, execute).install('0.164.0', new AbortController().signal, vi.fn());
    const args = execute.mock.calls[0][1] as string[];
    const candidate = execute.mock.calls[0][2].cwd as string;
    expect(args).toEqual(
      expect.arrayContaining([
        '--registry=https://registry.npmjs.org',
        '--ignore-scripts',
        `--userconfig=${path.join(candidate, '.npm-userconfig')}`,
        `--globalconfig=${path.join(candidate, '.npm-globalconfig')}`,
        '@openai/codex@0.164.0',
      ])
    );
  });

  it('keeps the selected CLI when npm fails and removes only this incomplete candidate', async () => {
    execute.mockRejectedValueOnce(new Error('download failed'));
    await expect(
      new CodexInstaller(data, execute).install('0.164.0', new AbortController().signal, vi.fn())
    ).rejects.toThrow();
    expect(await readlink(path.join(root, 'current'))).toBe('versions/previous');
    expect(await readdir(path.join(root, 'versions'))).toEqual(['previous']);
  });

  it('does not activate a CLI whose version differs from the selected stable release', async () => {
    const download = execute.getMockImplementation()!;
    execute.mockImplementation(async (command, args, options) =>
      args[0] === '--version' ? { stdout: 'codex-cli 0.163.0\n' } : download(command, args, options)
    );
    await expect(
      new CodexInstaller(data, execute).install('0.164.0', new AbortController().signal, vi.fn())
    ).rejects.toThrow('CODEX_VERSION_MISMATCH');
    expect(await readlink(path.join(root, 'current'))).toBe('versions/previous');
  });

  it('does not activate an incompatible app-server protocol', async () => {
    const download = execute.getMockImplementation()!;
    execute.mockImplementation(async (command, args, options) => {
      const result = await download(command, args, options);
      if (args[0] === 'app-server') await writeFile(path.join(args.at(-1), 'ClientRequest.json'), '{}');
      return result;
    });
    await expect(
      new CodexInstaller(data, execute).install('0.164.0', new AbortController().signal, vi.fn())
    ).rejects.toThrow('CODEX_PROTOCOL_INCOMPATIBLE');
    expect(await readlink(path.join(root, 'current'))).toBe('versions/previous');
  });

  it('does not load or modify the user account and memory config during validation', async () => {
    const home = path.join(data, 'codex');
    await mkdir(home);
    await writeFile(path.join(home, 'config.toml'), '[features]\nmemories = true\n');
    vi.stubEnv('CODEX_HOME', home);
    await new CodexInstaller(data, execute).install('0.164.0', new AbortController().signal, vi.fn());
    const probe = execute.mock.calls.find((call) => call[1][0] === 'app-server')!;
    expect(probe[2].env.CODEX_HOME).not.toBe(home);
    expect(await readFile(path.join(home, 'config.toml'), 'utf8')).toContain('memories = true');
  });

  it('preserves the selected CLI when installation is cancelled before activation', async () => {
    const controller = new AbortController();
    await expect(
      new CodexInstaller(data, execute).install('0.164.0', controller.signal, (phase) => {
        if (phase === 'verifying') controller.abort();
      })
    ).rejects.toThrow();
    expect(await readlink(path.join(root, 'current'))).toBe('versions/previous');
  });

  it('does not overwrite an unrelated file at the activation path', async () => {
    await rm(path.join(root, 'current'));
    await writeFile(path.join(root, 'current'), 'keep this file');
    await expect(
      new CodexInstaller(data, execute).install('0.164.0', new AbortController().signal, vi.fn())
    ).rejects.toThrow('CODEX_CURRENT_PATH_CONFLICT');
    expect((await lstat(path.join(root, 'current'))).isFile()).toBe(true);
  });

  it.each(['latest', '0.164.0-beta.1', '0.164.0; echo unsafe'])(
    'rejects an arbitrary installation target %s',
    async (version) => {
      await expect(
        new CodexInstaller(data, execute).install(version, new AbortController().signal, vi.fn())
      ).rejects.toThrow('INVALID_CODEX_VERSION');
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it('the stable launcher switches new invocations and retains a bundled fallback', async () => {
    const bundled = path.join(data, 'bundled-codex');
    await writeFile(bundled, '#!/bin/sh\nprintf "codex-cli 0.163.0\\n"\n', { mode: 0o755 });
    const launcher = path.resolve('packages/web-host/src/runtime/codex/codex');
    const env = { ...process.env, AIONUI_BUNDLED_CODEX: bundled };
    await rm(path.join(root, 'current'));
    expect((await execFileAsync(launcher, ['--version'], { env })).stdout.trim()).toBe('codex-cli 0.163.0');
    await new CodexInstaller(data, execute).install('0.164.0', new AbortController().signal, vi.fn());
    expect((await execFileAsync(launcher, ['--version'], { env })).stdout.trim()).toBe('codex-cli 0.164.0');
  });
});

describe('Codex protocol compatibility', () => {
  it('rejects a schema missing a required conversation operation', () => {
    expect(() => assertCodexProtocol({})).toThrow('CODEX_PROTOCOL_INCOMPATIBLE');
  });
});
