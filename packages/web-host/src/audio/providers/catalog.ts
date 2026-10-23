import { z } from 'zod';
import { DEFAULT_TRANSCRIPTION_MODEL, type AudioModel, type AudioModelCatalog } from '../types.js';

const schema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      type: z.string().optional(),
      modalities: z.object({ input: z.array(z.string()).optional() }).optional(),
      tags: z.array(z.string()).optional(),
      supported_parameters: z.array(z.string()).optional(),
      reasoning_options: z.array(z.object({ type: z.string(), values: z.array(z.string()).optional() })).optional(),
    })
  ),
});

/** Live Vercel model capabilities with a bounded cache; never infer audio support from text/image support. */
export class AudioCatalog {
  private cache?: AudioModelCatalog;
  private pending?: Promise<AudioModelCatalog>;
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async get(refresh = false): Promise<AudioModelCatalog> {
    if (!refresh && this.cache && Date.now() - this.cache.fetchedAt < 600000) return structuredClone(this.cache);
    if (!this.pending)
      this.pending = this.load().finally(() => {
        this.pending = undefined;
      });
    return structuredClone(await this.pending);
  }
  private async load(): Promise<AudioModelCatalog> {
    const response = await this.fetcher('https://ai-gateway.vercel.sh/v1/models', {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('AUDIO_CATALOG_UNAVAILABLE');
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new Error('AUDIO_CATALOG_UNAVAILABLE');
    const models: AudioModel[] = parsed.data.data
      .filter((model) => model.type === 'language' && !model.tags?.some((tag) => tag.startsWith('websocket')))
      .map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        audioInput: model.modalities?.input?.includes('audio') === true || model.id === DEFAULT_TRANSCRIPTION_MODEL,
        parameters: model.supported_parameters ?? [],
        reasoning:
          model.reasoning_options
            ?.filter((option) => option.type === 'effort')
            .flatMap((option) => option.values ?? []) ?? [],
      }))
      .toSorted((a, b) => Number(b.audioInput) - Number(a.audioInput) || a.name.localeCompare(b.name));
    this.cache = { models, fetchedAt: Date.now() };
    return this.cache;
  }
  async resolve(id: string): Promise<AudioModel> {
    const model = (await this.get()).models.find((item) => item.id === id);
    if (!model) throw new Error('AUDIO_MODEL_UNSUPPORTED');
    return model;
  }
}
