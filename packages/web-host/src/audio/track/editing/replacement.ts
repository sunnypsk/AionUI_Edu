import { randomUUID } from 'node:crypto';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AudioReplacementInput,
  AudioReplacementPreview,
} from '../../../../../desktop/src/common/types/platform/audioTools.ts';
import type {
  ListeningProject,
  ListeningSegment,
} from '../../../../../desktop/src/common/types/platform/listeningProject.ts';
import { renderTrack, type TrackOptions } from '../render.js';
import { parseProject } from '../project.js';

/** Validate a replacement against its original source clip, never an approximate transcript. */
export function replacementClip(
  project: ListeningProject,
  input: AudioReplacementInput
): Extract<ListeningSegment, { type: 'clip' }> {
  const clip = project.sections.flatMap((section) => section.segments).find((segment) => segment.id === input.clipId);
  if (
    clip?.type !== 'clip' ||
    !Number.isFinite(input.start) ||
    !Number.isFinite(input.end) ||
    input.end <= input.start ||
    input.start < clip.start ||
    input.end > clip.end
  )
    throw new Error('AUDIO_REPLACEMENT_INVALID');
  return clip;
}

/** Replace the selected interval, keeping both complementary source ranges and natural TTS duration. */
export function replaceRange(project: ListeningProject, input: AudioReplacementInput): ListeningProject {
  const clip = replacementClip(project, input);
  const id = (): string => `edit-${randomUUID()}`;
  const parts: ListeningSegment[] = [];
  const retained = (start: number, end: number): void => {
    if (end > start)
      parts.push({
        id: id(),
        type: 'clip',
        path: clip.path,
        start,
        end,
        ...(clip.note ? { note: clip.note } : {}),
        ...(clip.warnings ? { warnings: clip.warnings } : {}),
      });
  };
  retained(clip.start, input.start);
  parts.push({
    id: id(),
    type: 'speech',
    text: input.text,
    voice: input.voice,
    replaces: { path: clip.path, start: input.start, end: input.end },
  });
  retained(input.end, clip.end);
  return parseProject({
    ...project,
    sections: project.sections.map((section) => ({
      ...section,
      segments: section.segments.flatMap((segment) => (segment.id === clip.id ? parts : [segment])),
    })),
  });
}

/** Render before/after context using the same synthesis/cache path as a full render. */
export async function previewReplacement(
  options: TrackOptions,
  input: AudioReplacementInput
): Promise<{ files: string[]; preview: Omit<AudioReplacementPreview, 'beforePath' | 'afterPath'> }> {
  const clip = replacementClip(options.project, input);
  const start = Math.max(clip.start, input.start - 1);
  const end = Math.min(clip.end, input.end + 1);
  const contextClip = { ...clip, start, end };
  const before = parseProject({
    ...options.project,
    sections: [{ id: 'preview', plays: 1, gapBetweenPlays: 0, gapAfter: 0, segments: [contextClip] }],
  });
  const after = replaceRange(before, input);
  const results: { file: string; duration: number }[] = [];
  for (const [name, project] of [
    ['before', before],
    ['after', after],
  ] as const) {
    const directory = path.join(options.directory, name);
    await mkdir(directory, { mode: 0o700 });
    const result = await renderTrack({
      ...options,
      project,
      onlySections: undefined,
      directory,
      services: { ...options.services, transcribe: undefined },
      progress: async () => {},
    });
    const file = path.join(options.directory, name + '.mp3');
    await copyFile(result.files[0], file);
    results.push({ file, duration: result.durationSeconds });
  }
  const originalSeconds = input.end - input.start;
  // PCM timeline, rather than MP3 encoder padding, determines the shift.
  const timelineFile = path.join(options.directory, 'after', 'timeline.json');
  const { readFile } = await import('node:fs/promises');
  const timeline = JSON.parse(await readFile(timelineFile, 'utf8')) as {
    entries: { type: string; start: number; end: number }[];
  };
  const speech = timeline.entries.find((entry) => entry.type === 'speech');
  const replacementSeconds = speech
    ? speech.end - speech.start
    : results[1].duration - results[0].duration + originalSeconds;
  return {
    files: results.map((result) => result.file),
    preview: { originalSeconds, replacementSeconds, deltaSeconds: replacementSeconds - originalSeconds },
  };
}
