import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  LISTENING_LIMITS,
  listeningProjectSchema,
  type ListeningProject,
  type ListeningSegment,
} from '../../../../desktop/src/common/types/platform/listeningProject.ts';
import { sequenceTrack } from '../../../../desktop/src/common/types/platform/listeningTimeline.ts';
import { workspaceFile } from '../providers/media.js';
import type { AudioVoice } from '../types.js';

/** A rejected project; `details` are field paths and messages the agent can act on, never file contents. */
export class AudioProjectError extends Error {
  constructor(readonly details: string[]) {
    super('AUDIO_PROJECT_INVALID');
  }
}

/** Read a workspace project file as UTF-8 without following symlinks out of the workspace. */
export async function readProjectText(workspace: string, projectPath: string): Promise<{ file: string; text: string }> {
  const file = await workspaceFile(workspace, projectPath);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if ((await handle.stat()).size > LISTENING_LIMITS.PROJECT_BYTES) throw new Error('AUDIO_PROJECT_TOO_LARGE');
    return { file, text: new TextDecoder('utf-8', { fatal: true }).decode(await handle.readFile()) };
  } catch (error) {
    if (error instanceof Error && error.message === 'AUDIO_PROJECT_TOO_LARGE') throw error;
    throw new AudioProjectError(['file is not UTF-8 text']);
  } finally {
    await handle.close();
  }
}

/** Validate an already-decoded project value, reporting up to 20 field-level problems. */
export function parseProject(value: unknown): ListeningProject {
  const parsed = listeningProjectSchema.safeParse(value);
  if (!parsed.success)
    throw new AudioProjectError(
      parsed.error.issues.slice(0, 20).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    );
  return parsed.data;
}

/** Parse project JSON text. */
export function parseProjectText(text: string): ListeningProject {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new AudioProjectError([`invalid JSON: ${(error as Error).message.slice(0, 200)}`]);
  }
  return parseProject(value);
}

/** Read and validate a workspace project file. */
export async function loadProject(workspace: string, projectPath: string): Promise<ListeningProject> {
  return parseProjectText((await readProjectText(workspace, projectPath)).text);
}

/** Apply pronunciation fixes, longest match first so overlapping entries stay predictable. */
export function applyLexicon(text: string, lexicon: ListeningProject['lexicon']): string {
  let result = text;
  for (const entry of lexicon.toSorted((a, b) => b.match.length - a.match.length))
    result = result.replaceAll(entry.match, entry.speak);
  return result;
}
/** Map spoken (lexicon-applied) cue text back to the script wording for subtitles. */
export function restoreLexicon(text: string, lexicon: ListeningProject['lexicon']): string {
  let result = text;
  for (const entry of lexicon.toSorted((a, b) => b.speak.length - a.speak.length))
    result = result.replaceAll(entry.speak, entry.match);
  return result;
}

export type SpeechRequest = {
  key: string;
  text: string;
  voice: AudioVoice;
  rate: string;
  volume: string;
  pitch: string;
};
export type PlanItem =
  | { kind: 'speech'; sectionId: string; segmentId: string; play: number; original: string; request: SpeechRequest }
  | { kind: 'silence'; sectionId: string; segmentId?: string; play: number; seconds: number }
  | { kind: 'tone'; sectionId: string; segmentId: string; play: number; preset: 'start' | 'end' }
  | { kind: 'clip'; sectionId: string; segmentId: string; play: number; path: string; start: number; end: number };

/** Stable cache key: identical voice settings and spoken text always reuse the same synthesis. */
export function speechKey(request: Omit<SpeechRequest, 'key'>): string {
  return createHash('sha256')
    .update(JSON.stringify([1, request.voice, request.rate, request.volume, request.pitch, request.text]))
    .digest('hex')
    .slice(0, 32);
}

/** Resolve a speech segment's effective voice settings and lexicon-applied text. */
export function speechRequest(
  project: ListeningProject,
  segment: Extract<ListeningSegment, { type: 'speech' }>
): SpeechRequest {
  const value = {
    text: applyLexicon(segment.text, project.lexicon),
    voice: segment.voice ?? project.defaults.voice,
    rate: segment.rate ?? project.defaults.rate,
    volume: segment.volume ?? project.defaults.volume,
    pitch: segment.pitch ?? project.defaults.pitch,
  };
  return { key: speechKey(value), ...value };
}

/** Flatten sections into playback order, repeating plays and inserting gaps; trailing gap is dropped. */
export function planTrack(project: ListeningProject, onlySections?: string[]): PlanItem[] {
  const sections = onlySections?.length
    ? project.sections.filter((section) => onlySections.includes(section.id))
    : project.sections;
  if (onlySections?.length && sections.length !== new Set(onlySections).size)
    throw new AudioProjectError(
      onlySections
        .filter((id) => !project.sections.some((section) => section.id === id))
        .map((id) => `only_sections: unknown section ${id}`)
    );
  const items = sequenceTrack(project, onlySections).map((item): PlanItem => {
    const base = { sectionId: item.sectionId, play: item.play };
    if (item.kind === 'gap') return { kind: 'silence', ...base, seconds: item.seconds };
    const segment = item.segment;
    const owned = { ...base, segmentId: segment.id };
    if (segment.type === 'speech')
      return { kind: 'speech', ...owned, original: segment.text, request: speechRequest(project, segment) };
    if (segment.type === 'pause') return { kind: 'silence', ...owned, seconds: segment.seconds };
    if (segment.type === 'chime') return { kind: 'tone', ...owned, preset: segment.preset };
    return { kind: 'clip', ...owned, path: segment.path, start: segment.start, end: segment.end };
  });
  const fixed = items.reduce(
    (sum, item) => sum + (item.kind === 'silence' ? item.seconds : item.kind === 'clip' ? item.end - item.start : 0),
    0
  );
  if (fixed > LISTENING_LIMITS.TRACK_SECONDS) throw new Error('AUDIO_TRACK_TOO_LONG');
  return items;
}

/** Plain-text script for printing: section headings, speaker lines, pauses and repeat counts. */
export function formatScript(project: ListeningProject, onlySections?: string[]): string {
  const lines = [project.title, ''];
  for (const section of project.sections) {
    if (onlySections?.length && !onlySections.includes(section.id)) continue;
    lines.push(`【${section.label ?? section.id}】${section.plays > 1 ? ` ×${section.plays}` : ''}`);
    for (const segment of section.segments) {
      if (segment.type === 'speech') lines.push(segment.speaker ? `${segment.speaker}：${segment.text}` : segment.text);
      else if (segment.type === 'pause') lines.push(`（${segment.seconds}s${segment.note ? ` ${segment.note}` : ''}）`);
      else if (segment.type === 'clip' && segment.note) lines.push(`（${segment.note}）`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
