import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LISTENING_LIMITS } from '../../../desktop/src/common/types/platform/listeningProject.ts';
import type { AudioIssue } from '../../../desktop/src/common/types/platform/audioTools.ts';
import type { StudioMediaBlocks } from '../../../desktop/src/common/types/platform/audioStudio.ts';
import { workspaceFile } from '../audio/providers/media.js';
import { transcribeRegions, type AnalysisServices } from '../audio/track/analyze.js';
import { groupRegions, speechRegions, type BlockOptions, type Region } from '../audio/track/structure.js';
import { blocksPath, blocksSchema, STUDIO_BLOCKS_DIR } from './projects.js';

/** Blocks long enough to read as a sentence or two, short enough to find a mistake by skimming text. */
export const DEFAULT_BLOCKS: BlockOptions = { minSeconds: 8, maxSeconds: 40, breakSeconds: 3 };
const round = (value: number): number => Number(value.toFixed(3));

export type ImportOptions = {
  workspace: string;
  mediaPath: string;
  /** Private scratch folder for transcription chunks; the caller removes it. */
  directory: string;
  signal: AbortSignal;
  noiseDb?: number;
  blocks?: BlockOptions;
  services: AnalysisServices;
  progress: (completed: number, total: number) => Promise<void>;
};
export type ImportResult = { durationSeconds: number; blocks: number; warnings: string[]; issues: AudioIssue[] };

/**
 * Split a recording at silences into contiguous editing blocks, transcribe each one, and store the result as the
 * recording's block sidecar. Cuts fall in the middle of pauses so removing a block keeps natural spacing.
 */
export async function importMedia(options: ImportOptions): Promise<ImportResult> {
  const { services, signal } = options;
  const source = await workspaceFile(options.workspace, options.mediaPath);
  const duration = await services.probe(source, signal);
  if (!(duration > 0)) throw new Error('AUDIO_MEDIA_FAILED');
  if (duration > LISTENING_LIMITS.TRACK_SECONDS) throw new Error('AUDIO_TRACK_TOO_LONG');
  const silences = await services.silences(
    source,
    { noiseDb: options.noiseDb ?? -35, minSeconds: 0.5, duration },
    signal
  );
  signal.throwIfAborted();
  const grouped = groupRegions(speechRegions(silences, duration, 0.3), options.blocks ?? DEFAULT_BLOCKS);
  const regions: Region[] = grouped.length ? grouped : [{ start: 0, end: duration }];
  const warnings = new Set<string>();
  await options.progress(0, regions.length + 1);
  const issues = services.transcribe ? await transcribeRegions(options, source, regions, warnings) : [];
  if (!services.transcribe) warnings.add('AUDIO_ANALYSIS_NO_TRANSCRIPT');
  signal.throwIfAborted();
  const blocks = regions.map((region, index) => ({
    start: index ? round((regions[index - 1].end + region.start) / 2) : 0,
    end: index === regions.length - 1 ? round(duration) : round((region.end + regions[index + 1].start) / 2),
    ...(region.text?.trim() ? { text: region.text.trim() } : {}),
    ...(region.warnings?.length ? { warnings: region.warnings } : {}),
  }));
  const value: StudioMediaBlocks = blocksSchema.parse({
    version: 1,
    path: options.mediaPath,
    durationSeconds: round(duration),
    blocks,
    warnings: [...warnings],
  });
  await writeSidecar(options.workspace, blocksPath(options.mediaPath), JSON.stringify(value, null, 2) + '\n');
  await options.progress(regions.length + 1, regions.length + 1);
  return { durationSeconds: value.durationSeconds, blocks: blocks.length, warnings: value.warnings, issues };
}

/** Atomically replace a sidecar inside the workspace's hidden blocks folder, refusing symlinked folders. */
async function writeSidecar(workspace: string, relative: string, content: string): Promise<void> {
  const root = await realpath(workspace);
  const folder = path.join(root, STUDIO_BLOCKS_DIR);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  if ((await realpath(folder)) !== folder) throw new Error('AUDIO_FILE_FORBIDDEN');
  const file = path.join(root, relative);
  const temporary = path.join(folder, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
