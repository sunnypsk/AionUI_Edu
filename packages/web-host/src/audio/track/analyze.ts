import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LISTENING_LIMITS } from '../../../../desktop/src/common/types/platform/listeningProject.ts';
import { workspaceFile } from '../providers/media.js';
import { buildProject, speechRegions, type Interval, type Region } from './structure.js';

// Leave room for MP3 encoder padding so the transcriber never sees an extra near-empty five-minute chunk.
const TRANSCRIBE_WINDOW = 295;
export type AnalysisServices = {
  probe: (file: string, signal: AbortSignal) => Promise<number>;
  silences: (
    file: string,
    options: { noiseDb: number; minSeconds: number; duration: number },
    signal: AbortSignal
  ) => Promise<Interval[]>;
  cut: (file: string, destination: string, start: number, duration: number, signal: AbortSignal) => Promise<void>;
  transcribe?: (file: string, directory: string, signal: AbortSignal) => Promise<string>;
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
};

async function transcribeRegions(
  options: AnalysisOptions,
  source: string,
  regions: Region[],
  warnings: Set<string>
): Promise<void> {
  const transcribe = options.services.transcribe!;
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  let next = 0;
  let completed = 0;
  const worker = async (): Promise<void> => {
    while (next < regions.length) {
      signal.throwIfAborted();
      const index = next++;
      const region = regions[index];
      const parts: string[] = [];
      try {
        // Two region workers bound concurrency; chunks within a region retain their spoken order.
        for (let start = region.start; start < region.end; start += TRANSCRIBE_WINDOW) {
          signal.throwIfAborted();
          const directory = path.join(options.directory, 'region-' + index + '-' + parts.length);
          await mkdir(directory, { mode: 0o700 });
          const file = path.join(directory, 'part.mp3');
          await options.services.cut(source, file, start, Math.min(TRANSCRIBE_WINDOW, region.end - start), signal);
          const text = await transcribe(file, directory, signal);
          if (!text.trim()) throw new Error('AUDIO_RESPONSE_INVALID');
          parts.push(text);
        }
        region.text = parts.join('\n');
      } catch (error) {
        if (signal.aborted) throw error;
        // Preserve the entire original region when even one of its chunks cannot be transcribed.
        warnings.add('AUDIO_ANALYSIS_TRANSCRIPT_INCOMPLETE');
      }
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
  if (!regions.length) throw new Error('AUDIO_NO_SPEECH');
  const warnings = new Set<string>(['AUDIO_APPROXIMATE_TIMESTAMPS']);
  await options.progress(0, regions.length + 1);
  if (services.transcribe) await transcribeRegions(options, source, regions, warnings);
  else warnings.add('AUDIO_ANALYSIS_NO_TRANSCRIPT');
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
  };
}
