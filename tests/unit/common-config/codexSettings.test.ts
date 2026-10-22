import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexSettings } from '@/common/config/configKeys';
import { configService, readCodexSettings } from '@/common/config/configService';
import { isModelSelectionAvailable, selectCatalogModel } from '@/common/types/platform/cliModels';

describe('Codex settings persistence', () => {
  it('changes reasoning only to a capability advertised by the selected model', () => {
    const model = {
      id: 'live',
      displayName: 'Live',
      supportedReasoningEfforts: ['dynamic', 'future'],
      defaultReasoningEffort: 'dynamic',
      disabled: false,
    };
    expect(selectCatalogModel(model, 'future').reasoningEffort).toBe('future');
    expect(selectCatalogModel(model, 'low').reasoningEffort).toBe('dynamic');
    expect(
      selectCatalogModel({ ...model, supportedReasoningEfforts: [], defaultReasoningEffort: null }, 'future')
        .reasoningEffort
    ).toBeNull();
    expect(isModelSelectionAvailable({ model: 'live', reasoningEffort: 'low' }, [model])).toBe(false);
    expect(
      isModelSelectionAvailable({ model: 'live', reasoningEffort: 'future' }, [{ ...model, disabled: true }])
    ).toBe(false);
  });
  beforeEach(() => configService.reset());
  afterEach(() => {
    configService.reset();
    vi.unstubAllGlobals();
  });

  it('defaults to GPT-6 Astra with low reasoning on a fresh installation', () => {
    expect(readCodexSettings()).toEqual({ model: 'gpt-6-astra', reasoningEffort: 'low' });
  });

  it('ignores malformed persisted settings', () => {
    configService.setLocal('codex.settings', { model: ' ', reasoningEffort: 42 } as unknown as CodexSettings);
    expect(readCodexSettings()).toEqual({ model: 'gpt-6-astra', reasoningEffort: 'low' });
  });

  it('preserves new catalog efforts and models without configurable reasoning', () => {
    configService.setLocal('codex.settings', { model: 'future/model', reasoningEffort: 'ultra' });
    expect(readCodexSettings().reasoningEffort).toBe('ultra');
    configService.setLocal('codex.settings', { model: 'future/model', reasoningEffort: null });
    expect(readCodexSettings().reasoningEffort).toBeNull();
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

  it('sends the current browser CSRF token when saving confirmed settings', async () => {
    const document = { cookie: 'aionui-csrf-token=first-token' };
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', document);
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', request);
    await configService.setConfirmed('codex.settings', { model: 'live', reasoningEffort: 'ultra' });
    document.cookie = 'aionui-csrf-token=rotated-token';
    await configService.setConfirmed('codex.settings', { model: 'live', reasoningEffort: 'max' });
    expect(request.mock.calls.map(([, options]) => options.headers['x-csrf-token'])).toEqual([
      'first-token',
      'rotated-token',
    ]);
  });
});
