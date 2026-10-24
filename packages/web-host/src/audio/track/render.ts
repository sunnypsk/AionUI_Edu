import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  LISTENING_LIMITS,
  type ListeningProject,
  type ListeningQaIssue,
  type ListeningTimelineEntry,
} from '../../../../desktop/src/common/types/platform/listeningProject.ts';
import { layoutTimeline, sequenceTrack } from '../../../../desktop/src/common/types/platform/listeningTimeline.ts';
import { formatTranscript, normalizeSegments } from '../formats.js';
import { workspaceFile } from '../providers/media.js';
import type { SpeechOptions } from '../providers/edge.js';
import type { AudioSegment } from '../types.js';
import type { TrackMedia } from './ffmpeg.js';
import {
  AudioProjectError,
  formatScript,
  planTrack,
  restoreLexicon,
  type PlanItem,
  type SpeechRequest,
} from './project.js';
import { QA_THRESHOLD, qaRecordSchema, speechSimilarity } from './verify.js';

export const SEGMENT_CACHE = 'listening/.segments';
export type TrackServices = {
  media: TrackMedia;
  speak: (options: SpeechOptions) => Promise<{ segments: AudioSegment[] }>;
  /** Re-transcribe one synthesized file; absent when no transcription key is configured. */
  transcribe?: (source: string, directory: string, signal: AbortSignal) => Promise<string>;
};
export type TrackOptions = {
  project: ListeningProject;
  onlySections?: string[];
  workspace: string;
  directory: string;
  signal: AbortSignal;
  services: TrackServices;
  progress: (completed: number, total: number) => Promise<void>;
};
export type TrackResult = { files: string[]; durationSeconds: number; qaIssues: number; warnings: string[] };

const boundariesSchema = z
  .array(z.object({ text: z.string(), startSecond: z.number().finite(), endSecond: z.number().finite() }))
  .max(20000);
const synthesis = new Map<string, Promise<unknown>>();

/** Run `task` over `items` with at most `limit` in flight, failing fast on the first error. */
async function pool<T>(
  items: T[],
  limit: number,
  signal: AbortSignal,
  task: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      signal.throwIfAborted();
      await task(items[next++]);
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  const failure = settled.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

/** Content-addressed per-workspace cache; writes land via temp file + rename so readers never see partial files. */
class SegmentCache {
  private constructor(
    private readonly workspace: string,
    private readonly root: string
  ) {}
  static async open(workspace: string): Promise<SegmentCache> {
    const root = await realpath(workspace);
    const directory = path.join(root, ...SEGMENT_CACHE.split('/'));
    await mkdir(directory, { recursive: true });
    if ((await realpath(directory)) !== directory) throw new Error('AUDIO_FILE_FORBIDDEN');
    return new SegmentCache(workspace, directory);
  }
  /** Resolve a cached file, or undefined when it is absent or unsafe. */
  async file(name: string): Promise<string | undefined> {
    return workspaceFile(this.workspace, `${SEGMENT_CACHE}/${name}`).catch((): undefined => undefined);
  }
  async json<T>(name: string, schema: z.ZodType<T>): Promise<T | undefined> {
    const file = await this.file(name);
    if (!file) return undefined;
    const parsed = schema.safeParse(JSON.parse(await readFile(file, 'utf8').catch(() => 'null')));
    return parsed.success ? parsed.data : undefined;
  }
  /** Prevent another preview/render from overwriting the take already heard by a teacher. */
  async synthesize<T>(key: string, action: () => Promise<T>): Promise<T> {
    const name = `${this.root}\0${key}`;
    const pending = (synthesis.get(name) ?? Promise.resolve()).catch(() => {}).then(action);
    synthesis.set(name, pending);
    try {
      return await pending;
    } finally {
      if (synthesis.get(name) === pending) synthesis.delete(name);
    }
  }
  async put(name: string, source: string | { json: unknown }): Promise<string> {
    const destination = path.join(this.root, name);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    if (typeof source === 'string') await copyFile(source, temporary);
    else await writeFile(temporary, JSON.stringify(source.json), { flag: 'wx' });
    await rename(temporary, destination);
    return destination;
  }
}

type Speech = { request: SpeechRequest; file: string; boundaries: AudioSegment[]; heard?: string; accepted?: boolean };

async function synthesizeAll(
  options: TrackOptions,
  cache: SegmentCache,
  requests: SpeechRequest[],
  tick: () => Promise<void>
) {
  const speeches = new Map<string, Speech>();
  await pool(requests, 2, options.signal, async (request) => {
    const speech = await cache.synthesize(request.key, async () => {
      options.signal.throwIfAborted();
      let file = await cache.file(`${request.key}.mp3`);
      let boundaries = file ? await cache.json(`${request.key}.json`, boundariesSchema) : undefined;
      if (!file || !boundaries) {
        const directory = path.join(options.directory, `tts-${request.key}`);
        await mkdir(directory, { mode: 0o700 });
        const output = path.join(directory, 'speech.mp3');
        const result = await options.services.speak({
          action: 'start',
          wait_sec: 50,
          text: request.text,
          voice: request.voice,
          rate: request.rate,
          volume: request.volume,
          pitch: request.pitch,
          subtitles: true,
          boundary: 'SentenceBoundary',
          output,
          directory,
          signal: options.signal,
        });
        boundaries = result.segments;
        await cache.put(`${request.key}.json`, { json: boundaries });
        file = await cache.put(`${request.key}.mp3`, output);
      }
      return { request, file, boundaries };
    });
    speeches.set(request.key, speech);
    await tick();
  });
  return speeches;
}

async function verifyAll(
  options: TrackOptions,
  cache: SegmentCache,
  speeches: Map<string, Speech>,
  warnings: Set<string>,
  tick: () => Promise<void>
) {
  const transcribe = options.services.transcribe;
  if (!transcribe) {
    warnings.add('AUDIO_QA_SKIPPED');
    return;
  }
  await pool([...speeches.values()], 2, options.signal, async (speech) => {
    const cached = await cache.json(`${speech.request.key}.qa.json`, qaRecordSchema);
    if (cached) Object.assign(speech, { heard: cached.heard, accepted: cached.accepted });
    else
      try {
        const directory = path.join(options.directory, `qa-${speech.request.key}`);
        await mkdir(directory, { mode: 0o700 });
        const source = path.join(directory, 'source.mp3');
        await copyFile(speech.file, source);
        speech.heard = await transcribe(source, directory, options.signal);
        await cache.put(`${speech.request.key}.qa.json`, { json: { heard: speech.heard } });
      } catch (error) {
        if (options.signal.aborted) throw error;
        warnings.add('AUDIO_QA_INCOMPLETE');
      }
    await tick();
  });
}

/** Render a listening project into track.mp3 plus subtitles, timeline, printable script and QA report. */
export async function renderTrack(options: TrackOptions): Promise<TrackResult> {
  const { project, directory, signal, services } = options;
  const media =
    project.sourceAudio && services.media.forSource
      ? await services.media.forSource(await workspaceFile(options.workspace, project.sourceAudio), signal)
      : services.media;
  const plan = planTrack(project, options.onlySections);
  const requests = [
    ...new Map(
      plan.flatMap((item) => (item.kind === 'speech' ? [[item.request.key, item.request] as const] : []))
    ).values(),
  ];
  const verifying = !!services.transcribe;
  const total = requests.length * (verifying ? 2 : 1) + 1;
  let completed = 0;
  const tick = async (): Promise<void> => options.progress(++completed, total);
  await options.progress(0, total);
  const warnings = new Set<string>();
  const cache = await SegmentCache.open(options.workspace);
  const speeches = await synthesizeAll(options, cache, requests, tick);
  await verifyAll(options, cache, speeches, warnings, tick);

  // Decode each distinct piece once; repeated plays and identical pauses reuse the same PCM file.
  const pcm = path.join(directory, 'pcm');
  await mkdir(pcm, { mode: 0o700 });
  const pieces = new Map<string, { file: string; duration: number }>();
  const piece = async (item: PlanItem): Promise<{ file: string; duration: number }> => {
    const name =
      item.kind === 'speech'
        ? `speech-${item.request.key}`
        : item.kind === 'silence'
          ? `silence-${item.seconds}`
          : item.kind === 'tone'
            ? `tone-${item.preset}`
            : `clip-${item.segmentId}`;
    const existing = pieces.get(name);
    if (existing) return existing;
    const file = path.join(pcm, `${name}.wav`);
    if (item.kind === 'speech') await media.decode(speeches.get(item.request.key)!.file, file, signal);
    else if (item.kind === 'silence') await media.silence(file, item.seconds, signal);
    else if (item.kind === 'tone') await media.tone(file, item.preset, signal);
    else {
      const source = await workspaceFile(options.workspace, item.path).catch((error: Error) => {
        throw new AudioProjectError([`${item.segmentId}.path: ${error.message}`]);
      });
      if (item.end > (await media.probe(source, signal)) + 0.05)
        throw new AudioProjectError([`${item.segmentId}.end: beyond the end of ${item.path}`]);
      await media.decode(source, file, signal, { start: item.start, end: item.end });
    }
    const value = { file, duration: await media.probe(file, signal) };
    pieces.set(name, value);
    return value;
  };

  const measured = new Map<string, number>();
  const cues: AudioSegment[] = [];
  const order: string[] = [];
  let offset = 0;
  for (const item of plan) {
    const { file, duration } = await piece(item);
    order.push(file);
    if (item.segmentId) measured.set(item.segmentId, duration);
    if (item.kind === 'speech') {
      const local = normalizeSegments(speeches.get(item.request.key)!.boundaries, duration);
      const restore = item.request.text !== item.original;
      for (const cue of local.length ? local : [{ text: item.original, startSecond: 0, endSecond: duration }])
        cues.push({
          text: restore ? restoreLexicon(cue.text, project.lexicon) : cue.text,
          startSecond: cue.startSecond + offset,
          endSecond: cue.endSecond + offset,
        });
    }
    offset += duration;
    if (offset > LISTENING_LIMITS.TRACK_SECONDS) throw new Error('AUDIO_TRACK_TOO_LONG');
  }

  // Same layout the editor uses, so timeline.json and the live preview agree on positions.
  const entries: ListeningTimelineEntry[] = layoutTimeline(
    sequenceTrack(project, options.onlySections),
    project,
    (segment) => measured.get(segment.id)
  ).entries.map(({ estimated: _estimated, ...entry }) => entry);
  const track = path.join(directory, 'track.mp3');
  await media.assemble(order, track, signal);
  const durationSeconds = await media.probe(track, signal);
  await tick();

  const files = [track];
  const write = async (name: string, content: string): Promise<void> => {
    const file = path.join(directory, name);
    await writeFile(file, content, { flag: 'wx', mode: 0o600 });
    files.push(file);
  };
  await write('track.srt', formatTranscript('srt', cues));
  await write('timeline.json', JSON.stringify({ durationSeconds, entries }, null, 2) + '\n');
  await write('script.txt', formatScript(project, options.onlySections));
  let qaIssues = 0;
  if (verifying) {
    const issues: ListeningQaIssue[] = [];
    const checked = new Set<string>();
    for (const item of plan) {
      if (item.kind !== 'speech' || checked.has(item.segmentId)) continue;
      checked.add(item.segmentId);
      const { heard, accepted } = speeches.get(item.request.key)!;
      // A teacher-accepted reading stays accepted until the spoken text or voice changes the cache key.
      if (heard === undefined || accepted) continue;
      const score = speechSimilarity(item.original, item.request.text, heard);
      if (score < QA_THRESHOLD)
        issues.push({ segmentId: item.segmentId, expected: item.original, heard, similarity: score });
    }
    qaIssues = issues.length;
    await write('qa.json', JSON.stringify(issues, null, 2) + '\n');
  }
  return { files, durationSeconds, qaIssues, warnings: [...warnings] };
}
