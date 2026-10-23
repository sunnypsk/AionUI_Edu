import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultimodalTranscriber, type TranscriptionOptions } from '../providers/gemini.js';
import type { MediaServices } from '../providers/media.js';

describe('segmented multimodal transcription', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'audio-transcribe-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const options = (directory: string, duration: number): TranscriptionOptions => ({
    source: 'source.wav',
    directory,
    duration,
    model: {
      id: 'google/gemini-3.8-flash',
      name: 'Flash',
      audioInput: true,
      parameters: ['max_tokens', 'response_format'],
      reasoning: ['low'],
    },
    apiKey: 'fixture-key',
    language: 'yue-Hant-HK',
    signal: new AbortController().signal,
    progress: vi.fn(),
  });
  it('handles more than one hour with two in-flight chunks, ordered output and per-chunk usage', async () => {
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const firstPair = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ranges: [number, number][] = [];
    const files: MediaServices = {
      probe: vi.fn(),
      chunk: async (_source, file, start, duration) => {
        ranges.push([start, duration]);
        await writeFile(file, String(start));
      },
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      active++;
      peak = Math.max(peak, active);
      if (active === 2) release();
      await firstPair;
      const body = JSON.parse(String(init?.body)) as {
        messages: { content: { file?: { file_data: string } }[] }[];
        reasoning_effort: string;
      };
      const start = Number(Buffer.from(body.messages[0].content[1].file!.file_data.split(',')[1], 'base64').toString());
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return Response.json({
        id: `gen_${start}`,
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                text: `段落${start}`,
                segments: [{ text: `段落${start}`, startSecond: 0, endSecond: 0.5 }],
              }),
            },
          },
        ],
        usage: { cost: 0.001, prompt_tokens: 10, completion_tokens: 5 },
      });
    });
    const input = options(directory, 3601);
    const result = await new MultimodalTranscriber(fetcher, files).transcribe(input);
    expect(result.segments).toHaveLength(13);
    expect(result.segments.at(-1)).toMatchObject({ text: '段落3600', startSecond: 3600, endSecond: 3600.5 });
    expect({ requests: fetcher.mock.calls.length, peak, first: ranges[0], last: ranges.at(-1) }).toEqual({
      requests: 13,
      peak: 2,
      first: [0, 302],
      last: [3600, 1],
    });
    expect(vi.mocked(input.progress).mock.calls.reduce((sum, call) => sum + (call[2].costUsd ?? 0), 0)).toBeCloseTo(
      0.013
    );
  });
  it.each([400, 401, 429, 500])('never silently retries or switches models after HTTP %s', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private upstream error', { status }));
    const files: MediaServices = {
      probe: vi.fn(),
      chunk: async (_source, file) => {
        await writeFile(file, 'audio');
      },
    };
    await expect(new MultimodalTranscriber(fetcher, files).transcribe(options(directory, 20))).rejects.toThrow(
      /^AUDIO_/
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects truncated or invalid output instead of delivering a partial transcript', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: 'gen_truncated',
        usage: { cost: 0.004 },
        choices: [{ finish_reason: 'length', message: { content: '{' } }],
      })
    );
    const files: MediaServices = {
      probe: vi.fn(),
      chunk: async (_source, file) => {
        await writeFile(file, 'audio');
      },
    };
    const input = options(directory, 20);
    await expect(new MultimodalTranscriber(fetcher, files).transcribe(input)).rejects.toThrow('AUDIO_RESPONSE_INVALID');
    expect(input.progress).toHaveBeenCalledWith(
      0,
      1,
      expect.objectContaining({ chunk: 1, costUsd: 0.004, generationId: 'gen_truncated' })
    );
  });
  it('uses the selected model capabilities without sending unsupported reasoning parameters', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '{"segments":[{"text":"喺學校集合。","startSecond":0,"endSecond":21}]}' },
          },
        ],
      })
    );
    const files: MediaServices = {
      probe: vi.fn(),
      chunk: async (_source, file) => {
        await writeFile(file, 'audio');
      },
    };
    const input = options(directory, 20);
    input.model = { id: 'other/audio', name: 'Other', parameters: [], reasoning: [], audioInput: true };
    const result = await new MultimodalTranscriber(fetcher, files).transcribe(input);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body.model).toBe('other/audio');
    expect(result.segments[0].endSecond).toBe(20);
  });
});
