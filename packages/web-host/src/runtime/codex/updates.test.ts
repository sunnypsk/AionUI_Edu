import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexUpdateService } from './updates.js';

afterEach(() => vi.unstubAllGlobals());

describe('Codex CLI update checks', () => {
  it('reports the installed version without making an outbound request', async () => {
    const fetchLatest = vi.fn();
    const service = new CodexUpdateService(async () => '0.163.0', fetchLatest);
    expect(await service.status()).toEqual({
      installedVersion: '0.163.0',
      latestVersion: null,
      checkedAt: null,
      updateAvailable: null,
      canInstall: false,
      installation: { phase: 'idle', targetVersion: null },
    });
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it('compares semantic versions instead of sorting version strings', async () => {
    const service = new CodexUpdateService(
      async () => '0.9.0',
      async () => '0.163.0',
      () => new Date('2026-10-18T12:00:00Z')
    );
    expect(await service.check()).toMatchObject({ updateAvailable: true, checkedAt: '2026-10-18T12:00:00.000Z' });
  });

  it.each(['0.163.0', '0.162.0'])('does not offer a downgrade or reinstall of %s', async (latest) => {
    const service = new CodexUpdateService(
      async () => '0.163.0',
      async () => latest
    );
    expect((await service.check()).updateAvailable).toBe(false);
  });

  it('shares concurrent checks and briefly caches the last successful check', async () => {
    const fetchLatest = vi.fn().mockResolvedValue('0.164.0');
    let time = new Date('2026-10-18T12:00:00Z');
    const service = new CodexUpdateService(
      async () => '0.163.0',
      fetchLatest,
      () => time
    );
    await Promise.all([service.check(), service.check()]);
    await service.check();
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    time = new Date('2026-10-18T12:01:01Z');
    await service.check();
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous successful result when the registry is unavailable and allows retry', async () => {
    const fetchLatest = vi.fn().mockResolvedValueOnce('0.164.0').mockRejectedValueOnce(new Error('offline'));
    let time = new Date('2026-10-18T12:00:00Z');
    const service = new CodexUpdateService(
      async () => '0.163.0',
      fetchLatest,
      () => time
    );
    const previous = await service.check();
    time = new Date('2026-10-18T12:01:01Z');
    await expect(service.check()).rejects.toThrow();
    expect(await service.status()).toEqual(previous);
    fetchLatest.mockResolvedValueOnce('0.165.0');
    expect((await service.check()).latestVersion).toBe('0.165.0');
  });

  it.each(['not-a-version', '0.164.0-alpha.1'])(
    'rejects invalid or prerelease registry versions: %s',
    async (version) => {
      const service = new CodexUpdateService(
        async () => '0.163.0',
        async () => version
      );
      await expect(service.check()).rejects.toThrow('CODEX_UPDATE_CHECK_FAILED');
      expect((await service.status()).checkedAt).toBeNull();
    }
  );

  it('does not claim an installed version when the CLI cannot be read', async () => {
    const service = new CodexUpdateService(async () => {
      throw new Error('CLI missing');
    });
    await expect(service.status()).rejects.toThrow();
  });

  it('uses the fixed npm stable endpoint with a timeout and without following redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ version: '0.164.0', ignored: 'not returned' }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new CodexUpdateService(async () => '0.163.0');
    expect((await service.check()).latestVersion).toBe('0.164.0');
    expect(fetchMock).toHaveBeenCalledWith('https://registry.npmjs.org/@openai%2fcodex/latest', {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
  });

  it.each([Response.json({}, { status: 503 }), Response.json({ version: 'bad' }), new Response('invalid-json')])(
    'does not mark a failed registry response as a successful check',
    async (response) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      const service = new CodexUpdateService(async () => '0.163.0');
      await expect(service.check()).rejects.toThrow();
      expect((await service.status()).latestVersion).toBeNull();
    }
  );
});

describe('self-service update jobs', () => {
  it('coalesces double clicks and reports the selected version after installation', async () => {
    let version = '0.163.0';
    let finish!: () => void;
    const installer = {
      available: true,
      install: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        version = '0.164.0';
      }),
    };
    const service = new CodexUpdateService(
      async () => version,
      async () => '0.164.0',
      undefined,
      installer
    );
    await Promise.all([service.install(), service.install()]);
    await vi.waitFor(() => expect(installer.install).toHaveBeenCalledTimes(1));
    finish();
    await vi.waitFor(async () => expect((await service.status()).installation.phase).toBe('succeeded'));
    expect((await service.status()).installedVersion).toBe('0.164.0');
  });

  it('reports a failed update without leaking installation errors or changing the installed version', async () => {
    const installer = { available: true, install: vi.fn().mockRejectedValue(new Error('private diagnostic')) };
    const service = new CodexUpdateService(
      async () => '0.163.0',
      async () => '0.164.0',
      undefined,
      installer
    );
    await service.install();
    await vi.waitFor(async () => expect((await service.status()).installation.phase).toBe('failed'));
    expect(JSON.stringify(await service.status())).not.toContain('private diagnostic');
    expect((await service.status()).installedVersion).toBe('0.163.0');
  });

  it('does not reinstall when the installed version is already current', async () => {
    const installer = { available: true, install: vi.fn() };
    const service = new CodexUpdateService(
      async () => '0.163.0',
      async () => '0.163.0',
      undefined,
      installer
    );
    await service.install();
    await vi.waitFor(async () => expect((await service.status()).installation.phase).toBe('succeeded'));
    expect(installer.install).not.toHaveBeenCalled();
  });

  it('can retry a failed job without restarting the host', async () => {
    let version = '0.163.0';
    const installer = {
      available: true,
      install: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementationOnce(async () => {
          version = '0.164.0';
        }),
    };
    const service = new CodexUpdateService(
      async () => version,
      async () => '0.164.0',
      undefined,
      installer
    );
    await service.install();
    await vi.waitFor(async () => expect((await service.status()).installation.phase).toBe('failed'));
    await service.install();
    await vi.waitFor(async () => expect((await service.status()).installation.phase).toBe('succeeded'));
    expect((await service.status()).installedVersion).toBe('0.164.0');
  });

  it('aborts only the installer when the host closes', async () => {
    let installSignal: AbortSignal | undefined;
    const installer = {
      available: true,
      install: vi.fn(async (_version: string, signal: AbortSignal) => {
        installSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }),
    };
    const service = new CodexUpdateService(
      async () => '0.163.0',
      async () => '0.164.0',
      undefined,
      installer
    );
    await service.install();
    await vi.waitFor(() => expect(installer.install).toHaveBeenCalledTimes(1));
    service.close();
    expect(installSignal?.aborted).toBe(true);
    await vi.waitFor(async () => expect((await service.status()).installation.phase).toBe('failed'));
  });

  it('does not offer installation when the host has no stable runtime launcher', async () => {
    const service = new CodexUpdateService(async () => '0.163.0');
    await expect(service.install()).rejects.toThrow('CODEX_UPDATE_UNSUPPORTED');
  });
});

describe('update and cleanup coordination', () => {
  const inventory = { versions: [], supported: true, inspectionComplete: true, busy: false };
  const result = { removed: [], retained: [], inventory };

  it('blocks updates and a second cleanup while a cleanup is in progress', async () => {
    let finish!: (value: typeof result) => void;
    const retention = {
      inventory: vi.fn().mockResolvedValue({ ...inventory, busy: true }),
      cleanup: vi.fn(
        () =>
          new Promise<typeof result>((resolve) => {
            finish = resolve;
          })
      ),
    };
    const service = new CodexUpdateService(
      async () => '0.163.0',
      undefined,
      undefined,
      { available: true, install: vi.fn() },
      retention
    );
    const task = service.cleanup(['test-id']);
    await expect(service.install()).rejects.toThrow('CODEX_RUNTIME_BUSY');
    await expect(service.cleanup(['another-id'])).rejects.toThrow('CODEX_RUNTIME_BUSY');
    finish(result);
    await task;
  });

  it('blocks cleanup while an installation is in progress', async () => {
    let finish!: () => void;
    let version = '0.163.0';
    const installer = {
      available: true,
      install: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        version = '0.164.0';
      }),
    };
    const retention = { inventory: vi.fn().mockResolvedValue(inventory), cleanup: vi.fn() };
    const service = new CodexUpdateService(
      async () => version,
      async () => '0.164.0',
      undefined,
      installer,
      retention
    );
    await service.install();
    await vi.waitFor(() => expect(installer.install).toHaveBeenCalled());
    await expect(service.cleanup(['test-id'])).rejects.toThrow('CODEX_RUNTIME_BUSY');
    expect(retention.cleanup).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(async () => expect((await service.status()).installation.phase).toBe('succeeded'));
  });

  it('releases the cleanup guard after a failure so the user can retry', async () => {
    const retention = {
      inventory: vi.fn().mockResolvedValue(inventory),
      cleanup: vi.fn().mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValueOnce(result),
    };
    const service = new CodexUpdateService(async () => '0.163.0', undefined, undefined, undefined, retention);
    await expect(service.cleanup(['test-id'])).rejects.toThrow();
    expect(await service.cleanup(['test-id'])).toEqual(result);
  });
});
