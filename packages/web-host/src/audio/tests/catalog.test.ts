import { describe, expect, it, vi } from 'vitest';
import { AudioCatalog } from '../providers/catalog.js';

describe('live multimodal audio model catalog', () => {
  it('retains the verified Flash exception and excludes dedicated and streaming models', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({
        data: [
          { id: 'google/gemini-3.8-flash', name: 'Flash', type: 'language', modalities: { input: ['text', 'image'] } },
          { id: 'other/audio', type: 'language', modalities: { input: ['text', 'audio'] } },
          {
            id: 'other/manual',
            type: 'language',
            modalities: { input: ['text', 'image'] },
            reasoning_options: [{ type: 'toggle' }, { type: 'budget_tokens', min: 1, max: 1024 }],
          },
          { id: 'google/gemini-3.5-transcribe', type: 'transcription' },
          { id: 'other/live', type: 'language', tags: ['websocket-realtime'] },
        ],
      })
    );
    const catalog = new AudioCatalog(fetcher);
    const models = (await catalog.get()).models;
    expect(models.filter((model) => model.audioInput).map((model) => model.id)).toEqual([
      'google/gemini-3.8-flash',
      'other/audio',
    ]);
    expect((await catalog.resolve('other/manual')).id).toBe('other/manual');
    await expect(catalog.resolve('google/gemini-3.5-transcribe')).rejects.toThrow('AUDIO_MODEL_UNSUPPORTED');
    await catalog.get();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await catalog.get(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('reports refresh failure without deleting the existing cache', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'other/audio', type: 'language' }] }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const catalog = new AudioCatalog(fetcher);
    await catalog.get();
    await expect(catalog.get(true)).rejects.toThrow('AUDIO_CATALOG_UNAVAILABLE');
    expect((await catalog.get()).models[0].id).toBe('other/audio');
  });
});
