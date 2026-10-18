import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexSettings } from '@/common/config/configKeys';
import { configService, readCodexSettings } from '@/common/config/configService';

describe('Codex settings persistence', () => {
  beforeEach(() => configService.reset());
  afterEach(() => {
    configService.reset();
    vi.unstubAllGlobals();
  });

  it('defaults to GPT-6 Astra with low reasoning on a fresh installation', () => {
    expect(readCodexSettings()).toEqual({ model: 'gpt-6-astra', reasoningEffort: 'low' });
  });

  it('ignores malformed persisted settings', () => {
    configService.setLocal('codex.settings', { model: ' ', reasoningEffort: 'invalid' } as unknown as CodexSettings);
    expect(readCodexSettings()).toEqual({ model: 'gpt-6-astra', reasoningEffort: 'low' });
  });

  it('restores saved settings loaded from the server after a reload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          data: {
            'codex.settings': { model: 'gpt-6-astra', reasoningEffort: 'high' },
          },
        })
      )
    );
    await configService.initialize();
    expect(readCodexSettings()).toEqual({ model: 'gpt-6-astra', reasoningEffort: 'high' });
  });

  it('publishes changes only after the server confirms the save', async () => {
    let finishSave!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finishSave = resolve;
          })
      )
    );
    const onChange = vi.fn();
    configService.subscribe('codex.settings', onChange);
    const saving = configService.setConfirmed('codex.settings', { model: 'gpt-6-astra', reasoningEffort: 'high' });
    expect(readCodexSettings().reasoningEffort).toBe('low');
    expect(onChange).not.toHaveBeenCalled();
    finishSave(new Response(null, { status: 204 }));
    await saving;
    expect(readCodexSettings().reasoningEffort).toBe('high');
  });

  it('keeps the previous configuration when persistence fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));
    await expect(
      configService.setConfirmed('codex.settings', { model: 'gpt-6-astra', reasoningEffort: 'max' })
    ).rejects.toThrow('503');
    expect(readCodexSettings().reasoningEffort).toBe('low');
  });
});
