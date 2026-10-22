import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readlink, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DroidExecutable } from '../../droid/runtime/executable.js';
import { DroidInstaller } from '../../droid/runtime/installer.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

describe.skipIf(process.platform === 'win32')('atomic Droid updates', () => {
  let directory: string;
  let runtime: DroidExecutable;
  const binary = '#!/bin/sh\nprintf "0.247.0\\n"\n';
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'droid-install-'));
    runtime = new DroidExecutable(directory, '', '/bundled/droid', true);
    await mkdir(path.join(runtime.root, 'versions/old'), { recursive: true });
    await writeFile(path.join(runtime.root, 'versions/old/droid'), 'old');
    await symlink('versions/old', path.join(runtime.root, 'current'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const request = (body = binary, badChecksum = false) =>
    vi
      .fn<typeof fetch>()
      .mockImplementation(
        async (url) =>
          new Response(
            String(url).endsWith('.sha256')
              ? badChecksum
                ? '0'.repeat(64)
                : createHash('sha256').update(body).digest('hex')
              : body
          )
      );
  it('verifies the candidate before activation and preserves the old executable', async () => {
    const fetcher = request();
    const verify = vi.fn(async () => {
      expect(await runtime.resolve()).toBe(path.join(runtime.root, 'versions/old/droid'));
    });
    await new DroidInstaller(runtime, fetcher, 'linux', 'x64').install(
      '0.247.0',
      new AbortController().signal,
      () => {},
      verify
    );
    expect(verify).toHaveBeenCalledOnce();
    expect(await readlink(path.join(runtime.root, 'current'))).toMatch(/^versions\/0\.247\.0-/);
    expect(await readdir(path.join(runtime.root, 'versions'))).toHaveLength(2);
    expect(String(fetcher.mock.calls[0][0])).toContain('/linux/x64-baseline/droid.sha256');
  });
  it.each(['checksum', 'version', 'protocol', 'abort'] as const)(
    'keeps the active release when %s verification fails',
    async (failure) => {
      const controller = new AbortController();
      const fetcher = request(
        failure === 'version' ? binary.replace('0.247.0', '0.1.0') : binary,
        failure === 'checksum'
      );
      const verify = async () => {
        if (failure === 'abort') controller.abort();
        else throw new Error('SPECIALIST_TOOLS_NOT_ISOLATED');
      };
      await expect(
        new DroidInstaller(runtime, fetcher, 'linux', 'x64').install('0.247.0', controller.signal, () => {}, verify)
      ).rejects.toThrow();
      expect(await readlink(path.join(runtime.root, 'current'))).toBe('versions/old');
      expect(await readdir(path.join(runtime.root, 'versions'))).toEqual(['old']);
    }
  );
  it('does not overwrite an external CLI', async () => {
    const external = new DroidExecutable(directory, '/external/droid', '/bundled/droid', true);
    expect(external.available).toBe(false);
    expect(await external.resolve()).toBe('/external/droid');
    await expect(
      new DroidInstaller(external, request()).install(
        '0.247.0',
        new AbortController().signal,
        () => {},
        async () => {}
      )
    ).rejects.toThrow('FACTORY_UPDATE_UNSUPPORTED');
  });
  it('discards an interrupted download without touching the active release', async () => {
    const fetcher = request();
    fetcher.mockResolvedValueOnce(new Response(createHash('sha256').update(binary).digest('hex')));
    fetcher.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(binary.slice(0, 8)));
            controller.error(new Error('connection interrupted'));
          },
        })
      )
    );
    const verify = vi.fn();
    await expect(
      new DroidInstaller(runtime, fetcher, 'linux', 'x64').install(
        '0.247.0',
        new AbortController().signal,
        () => {},
        verify
      )
    ).rejects.toThrow('connection interrupted');
    expect(verify).not.toHaveBeenCalled();
    expect(await readlink(path.join(runtime.root, 'current'))).toBe('versions/old');
    expect(await readdir(path.join(runtime.root, 'versions'))).toEqual(['old']);
  });
  it('retains the previous release if the atomic activation fails', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementationOnce(actual.rename).mockRejectedValueOnce(new Error('activation failed'));
    await expect(
      new DroidInstaller(runtime, request(), 'linux', 'x64').install(
        '0.247.0',
        new AbortController().signal,
        () => {},
        async () => {}
      )
    ).rejects.toThrow('activation failed');
    expect(await readlink(path.join(runtime.root, 'current'))).toBe('versions/old');
    expect(await readdir(path.join(runtime.root, 'versions'))).toEqual(['old']);
  });
  it('allows a running process to finish on its original binary after activation', async () => {
    const previous = await runtime.resolve();
    await writeFile(previous, '#!/bin/sh\nprintf "started\\n"\nread reply\nprintf "completed previous\\n"\n', {
      mode: 0o700,
    });
    const { chmod } = await import('node:fs/promises');
    await chmod(previous, 0o700);
    const child = spawn(previous, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    try {
      await once(child.stdout, 'data');
      await new DroidInstaller(runtime, request(), 'linux', 'x64').install(
        '0.247.0',
        new AbortController().signal,
        () => {},
        async () => {}
      );
      expect(await runtime.resolve()).not.toBe(previous);
      const exited = once(child, 'exit');
      child.stdin.end('finish\n');
      expect((await exited)[0]).toBe(0);
      expect(output).toContain('completed previous');
    } finally {
      if (child.exitCode === null) child.kill();
    }
  });
});
