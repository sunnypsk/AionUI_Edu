/** Opt-in real FFmpeg long-file gate; all transcription responses are local fixtures. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { MultimodalTranscriber } from '../providers/gemini.js';
import { media, runProcess } from '../providers/media.js';
import { formatTranscript } from '../formats.js';

it.runIf(process.env.AIONUI_AUDIO_LONG_TEST === '1')(
  'processes an actual recording longer than one hour using FFmpeg and mocked model responses',
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'audio-hour-'));
    const started = Date.now();
    try {
      const source = path.join(directory, 'hour.mp3');
      const signal = AbortSignal.timeout(160000);
      await runProcess(
        process.env.AIONUI_FFMPEG ?? 'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-n',
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=24000:cl=mono',
          '-t',
          '3601',
          '-codec:a',
          'libmp3lame',
          '-b:a',
          '48k',
          source,
        ],
        signal
      );
      const duration = await media.probe(source, signal);
      let requests = 0;
      let bytes = 0;
      const costs: number[] = [];
      const transcriber = new MultimodalTranscriber(async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          messages: { content: { file?: { file_data: string } }[] }[];
        };
        bytes += Buffer.from(request.messages[0].content[1].file!.file_data.split(',')[1], 'base64').length;
        requests++;
        return Response.json({
          id: `gen_fixture_${requests}`,
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  segments: [{ text: `測試段落${requests}。`, startSecond: 0.1, endSecond: 1 }],
                }),
              },
            },
          ],
          usage: { cost: 0.001 },
        });
      });
      const result = await transcriber.transcribe({
        source,
        directory,
        duration,
        model: { id: 'fixture/audio', name: 'Fixture', parameters: ['max_tokens'], reasoning: [], audioInput: true },
        apiKey: 'fixture-not-a-real-key',
        language: 'yue-Hant-HK',
        signal,
        progress: async (_completed, _total, usage) => {
          costs.push(usage.costUsd!);
        },
      });
      expect(duration).toBeGreaterThan(3600);
      expect({ requests, segments: result.segments.length, lastStart: result.segments.at(-1)?.startSecond }).toEqual({
        requests: 13,
        segments: 13,
        lastStart: 3600.1,
      });
      expect(costs.reduce((sum, cost) => sum + cost, 0)).toBeCloseTo(0.013);
      const srt = formatTranscript('srt', result.segments);
      assert(srt.includes('01:00:00,100'));
      const report = {
        inputDurationSeconds: duration,
        inputBytes: (await readFile(source)).length,
        requests,
        bytesSentToFixture: bytes,
        outputCues: result.segments.length,
        outputLastEnd: result.segments.at(-1)?.endSecond,
        elapsedSeconds: (Date.now() - started) / 1000,
        liveInference: false,
      };
      if (process.env.AIONUI_AUDIO_LONG_REPORT)
        await writeFile(process.env.AIONUI_AUDIO_LONG_REPORT, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  180000
);
