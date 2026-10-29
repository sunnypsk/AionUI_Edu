import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LISTENING_LIMITS } from '../../../../desktop/src/common/types/platform/listeningProject.ts';
import { workspaceFile } from '../providers/media.js';
import { buildProject, speechRegions, type Interval, type Region } from './structure.js';
import { audioError } from '../types.js';
import type { AudioIssue, AudioSegment } from '../../../../desktop/src/common/types/platform/audioTools.ts';
import { AudioTranscriptionError } from '../providers/gemini.js';

// Leave room for MP3 encoder padding so the transcriber never sees an extra near-empty five-minute chunk.
const TRANSCRIBE_WINDOW = 295;
const round = (value: number): number => Number(value.toFixed(3));
export type AnalysisServices = {
  probe: (file: string, signal: AbortSignal) => Promise<number>;
  silences: (
    file: string,
    options: { noiseDb: number; minSeconds: number; duration: number },
    signal: AbortSignal
  ) => Promise<Interval[]>;
  cut: (file: string, destination: string, start: number, duration: number, signal: AbortSignal) => Promise<void>;
  /** Plain text, or timed segments (seconds within `file`) when the caller wants cues for later edits. */
  transcribe?: (file: string, directory: string, signal: AbortSignal) => Promise<string | AudioSegment[]>;
};
export type AnalysisOptions = {
  workspace: string;
  audioPath: string;
  directory: string;
  /** Final workspace-relative task directory; only the manager publishes its completed bundle. */
  outputPath: string;
  signal: AbortSignal;
  mode: 'speech' | 'clip';
  title?: string;
  noiseDb: number;
  mergeGap: number;
  sectionGap: number;
  services: AnalysisServices;
  progress: (completed: number, total: number) => Promise<void>;
};
export type AnalysisResult = {
  files: string[];
  projectPath: string;
  durationSeconds: number;
  warnings: string[];
  summary: string;
  issues: AudioIssue[];
};

/**
 * Transcribe each region in place (`region.text`, plus `region.cues` when every window returned timings), two at
 * a time; failed chunks become issues and warnings.
 */
export async function transcribeRegions(
  options: Pick<AnalysisOptions, 'directory' | 'signal' | 'services' | 'progress'>,
  source: string,
  regions: Region[],
  warnings: Set<string>
): Promise<AudioIssue[]> {
  const transcribe = options.services.transcribe!;
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  let next = 0;
  let completed = 0;
  const issues: AudioIssue[] = [];
  const worker = async (): Promise<void> => {
    while (next < regions.length) {
      signal.throwIfAborted();
      const index = next++;
      const region = regions[index];
      const parts: string[] = [];
      let cues: Region['cues'] = [];
      let part = 0;
      // Two region workers bound concurrency; a failed chunk never discards its successful neighbours.
      for (let start = region.start; start < region.end; start += TRANSCRIBE_WINDOW) {
        signal.throwIfAborted();
        const end = Math.min(region.end, start + TRANSCRIBE_WINDOW);
        try {
          const directory = path.join(options.directory, 'region-' + index + '-' + part++);
          await mkdir(directory, { mode: 0o700 });
          const file = path.join(directory, 'part.mp3');
          await options.services.cut(source, file, start, end - start, signal);
          const result = await transcribe(file, directory, signal);
          const text = typeof result === 'string' ? result : result.map((segment) => segment.text).join('');
          if (!text.trim()) throw new Error('AUDIO_NO_SPEECH');
          parts.push(text);
          if (typeof result === 'string') cues = undefined;
          else
            cues?.push(
              ...result.map((segment) => ({
                text: segment.text,
                startSecond: round(start + Math.max(0, Math.min(end - start, segment.startSecond))),
                endSecond: round(start + Math.max(0, Math.min(end - start, segment.endSecond))),
              }))
            );
        } catch (error) {
          if (signal.aborted) throw error;
          // Cues with a gap would assign the wrong words to a later split, so keep none.
          cues = undefined;
          const failures =
            error instanceof AudioTranscriptionError
              ? error.issues.map((issue) => ({
                  code: issue.code,
                  startSecond: Math.max(start, Math.min(end, start + issue.startSecond)),
                  endSecond: Math.max(start, Math.min(end, start + issue.endSecond)),
                }))
              : [{ code: audioError(error), startSecond: start, endSecond: end }];
          issues.push(...failures);
          region.warnings = [...new Set([...(region.warnings ?? []), ...failures.map((issue) => issue.code)])];
          warnings.add('AUDIO_ANALYSIS_TRANSCRIPT_INCOMPLETE');
        }
      }
      if (parts.length) region.text = parts.join('\n');
      if (parts.length && cues?.length) region.cues = cues;
      signal.throwIfAborted();
      await options.progress(++completed, regions.length + 1);
    }
  };
  const pending = Array.from({ length: Math.min(2, regions.length) }, () =>
    worker().catch((error: unknown) => {
      controller.abort();
      throw error;
    })
  );
  // Join all workers before the manager removes temporary files after cancellation.
  const settled = await Promise.allSettled(pending);
  const failure = settled.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return issues.toSorted((a, b) => a.startSecond - b.startSecond);
}

/** Analyze into a private draft bundle, ready for the manager's cancellation-safe publication. */
export async function analyzeReference(options: AnalysisOptions): Promise<AnalysisResult> {
  const { services, signal, directory } = options;
  signal.throwIfAborted();
  const original = await workspaceFile(options.workspace, options.audioPath);
  const extension = path.extname(original).toLowerCase();
  const sourceName = 'reference' + (/^\.[a-z0-9]+$/.test(extension) ? extension : '.audio');
  const source = path.join(directory, sourceName);
  await copyFile(original, source);
  signal.throwIfAborted();
  const duration = await services.probe(source, signal);
  if (duration > LISTENING_LIMITS.TRACK_SECONDS) throw new Error('AUDIO_TRACK_TOO_LONG');
  const silences = await services.silences(source, { noiseDb: options.noiseDb, minSeconds: 0.5, duration }, signal);
  signal.throwIfAborted();
  const regions: Region[] = speechRegions(silences, duration, Math.min(options.mergeGap, options.sectionGap));
  if (!regions.length) {
    if (options.mode === 'speech') throw new Error('AUDIO_NO_SPEECH');
    regions.push({ start: 0, end: duration });
  }
  const warnings = new Set<string>(['AUDIO_APPROXIMATE_TIMESTAMPS']);
  await options.progress(0, regions.length + 1);
  const failures = services.transcribe ? await transcribeRegions(options, source, regions, warnings) : [];
  if (!services.transcribe) warnings.add('AUDIO_ANALYSIS_NO_TRANSCRIPT');
  signal.throwIfAborted();
  const title = (
    options.title?.trim() ||
    path.basename(options.audioPath).replace(/\.[^.]+$/, '') ||
    'Reference'
  ).slice(0, 200);
  const project = buildProject(regions, {
    title,
    audioPath: options.outputPath + '/' + sourceName,
    mode: options.mode,
    duration,
    sectionGap: options.sectionGap,
    padding: 0.15,
  });
  const clips = project.sections.flatMap((section) => section.segments).filter((segment) => segment.type === 'clip');
  const issues = failures.map((issue) => ({
    ...issue,
    segmentId: clips.find((clip) => clip.start < issue.endSecond && clip.end > issue.startSecond)?.id,
  }));
  if (
    options.mode === 'speech' &&
    project.sections.some((section) => section.segments.some((segment) => segment.type === 'clip'))
  )
    warnings.add('AUDIO_ANALYSIS_CLIP_FALLBACK');
  const report = path.join(directory, 'analysis.json');
  await writeFile(
    report,
    JSON.stringify(
      {
        durationSeconds: duration,
        sourcePath: options.audioPath,
        silences,
        regions,
        issues,
        sections: project.sections.map((section) => ({ id: section.id, plays: section.plays })),
        warnings: [...warnings],
      },
      null,
      2
    ) + '\n',
    { flag: 'wx', mode: 0o600 }
  );
  const draft = path.join(directory, 'reference.listening.json');
  await writeFile(draft, JSON.stringify(project, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  signal.throwIfAborted();
  await options.progress(regions.length + 1, regions.length + 1);
  signal.throwIfAborted();
  return {
    files: [draft, report, source],
    projectPath: options.outputPath + '/reference.listening.json',
    durationSeconds: duration,
    warnings: [...warnings],
    summary: title,
    issues,
  };
}
