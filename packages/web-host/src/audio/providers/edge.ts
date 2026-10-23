import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AudioSegment, SpeechInput } from '../types.js';
import { runProcess } from './media.js';

export const VOICES = { HiuMaan: 'zh-HK-HiuMaanNeural', WanLung: 'zh-HK-WanLungNeural' } as const;
export type SpeechOptions = SpeechInput & { output: string; directory: string; signal: AbortSignal };
/** Locate source-owned helpers in both the bundled Node host and a source checkout. */
function appRoot(): string {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  return (
    process.env.AIONUI_APP_ROOT ??
    (path.basename(directory) === 'providers'
      ? path.resolve(directory, '../../../../..')
      : path.resolve(directory, '../..'))
  );
}
export function audioResource(name: string): string {
  return path.join(appRoot(), 'packages/web-host/src/audio/providers', name);
}
export function audioPython(): string {
  if (process.env.AIONUI_AUDIO_PYTHON) return process.env.AIONUI_AUDIO_PYTHON;
  if (process.env.AIONUI_CONTAINER === '1') return '/opt/aionui-audio/bin/python';
  return path.resolve(
    appRoot(),
    '.cache/audio-tools/venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  );
}
const segmentSchema = z
  .array(z.object({ text: z.string(), startSecond: z.number().finite(), endSecond: z.number().finite() }))
  .max(200000);
export async function synthesize(options: SpeechOptions): Promise<{ segments: AudioSegment[] }> {
  const metadata = path.join(options.directory, 'boundaries.json');
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'TZ',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  await runProcess(
    audioPython(),
    [audioResource('edgeWorker.py')],
    AbortSignal.any([options.signal, AbortSignal.timeout(1200000)]),
    JSON.stringify({
      text: options.text,
      voice: VOICES[options.voice],
      rate: options.rate,
      volume: options.volume,
      pitch: options.pitch,
      boundary: options.boundary,
      output: options.output,
      metadata,
    }),
    env
  );
  return { segments: segmentSchema.parse(JSON.parse(await readFile(metadata, 'utf8'))) };
}
