import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { FactoryProvider } from '../../droid/provider/sdk.js';
import { DroidExecutable } from '../../droid/runtime/executable.js';
import { DroidInstaller } from '../../droid/runtime/installer.js';
import { DroidUpdateService } from '../../droid/runtime/updates.js';

describe('Droid update coordination', () => {
  let directory: string;
  let provider: FactoryProvider;
  let service: DroidUpdateService;
  let installer: DroidInstaller;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'droid-updates-'));
    provider = new FactoryProvider(directory);
    vi.spyOn(provider, 'version').mockResolvedValue('0.245.1');
    installer = new DroidInstaller(new DroidExecutable(directory, '', '/bundled', true));
  });
  afterEach(async () => {
    await service?.close();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  it('coalesces checks and invalidates model caches after a single concurrent install', async () => {
    const latest = vi.fn(async () => '0.247.0');
    const install = vi.spyOn(installer, 'install').mockImplementation(async (_v, _s, phase) => {
      phase('verifying');
    });
    const invalidate = vi.spyOn(provider, 'invalidate');
    service = new DroidUpdateService(provider, installer, latest);
    await Promise.all([service.check(), service.check()]);
    expect(latest).toHaveBeenCalledOnce();
    await Promise.all([service.install('teacher'), service.install('teacher')]);
    await vi.waitFor(async () => expect((await service.status()).installation.phase).toBe('succeeded'));
    expect(install).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
  });
  it('reports a sanitized failure and leaves the version cache unchanged', async () => {
    vi.spyOn(installer, 'install').mockRejectedValue(new Error('private upstream detail'));
    const invalidate = vi.spyOn(provider, 'invalidate');
    service = new DroidUpdateService(provider, installer, async () => '0.247.0');
    await service.install('teacher');
    await vi.waitFor(async () => expect((await service.status()).installation.phase).toBe('failed'));
    expect((await service.status()).installation.error).toBe('SPECIALIST_UNAVAILABLE');
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('rejects non-stable metadata without making it available for installation', async () => {
    service = new DroidUpdateService(provider, installer, async () => '0.248.0-beta');
    await expect(service.check()).rejects.toThrow('FACTORY_UPDATE_CHECK_FAILED');
    expect((await service.status()).latestVersion).toBeNull();
  });
});
