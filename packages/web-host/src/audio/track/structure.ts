import {
  LISTENING_LIMITS,
  listeningProjectSchema,
  type ListeningProject,
  type ListeningSection,
  type ListeningSegment,
} from '../../../../desktop/src/common/types/platform/listeningProject.ts';

export const MAX_REGIONS = 200;
export type Interval = { start: number; end: number };
export type Region = Interval & {
  text?: string;
  /** Timed transcript pieces in source seconds, when the transcriber reported timings. */
  cues?: { text: string; startSecond: number; endSecond: number }[];
  warnings?: string[];
};
export type StructureOptions = {
  title: string;
  audioPath: string;
  mode: 'speech' | 'clip';
  duration: number;
  sectionGap: number;
  padding: number;
};
const round = (value: number): number => Number(value.toFixed(3));

/** Complement silence intervals, preserving short chimes and merging nearby or excessive regions. */
export function speechRegions(silences: Interval[], duration: number, mergeGap: number): Interval[] {
  const regions: Interval[] = [];
  let cursor = 0;
  for (const silence of silences.toSorted((a, b) => a.start - b.start)) {
    if (!Number.isFinite(silence.start) || !Number.isFinite(silence.end) || silence.end <= silence.start) continue;
    const start = Math.max(0, Math.min(duration, silence.start));
    if (start - cursor >= 0.02) regions.push({ start: cursor, end: start });
    cursor = Math.max(cursor, Math.min(duration, silence.end));
  }
  if (duration - cursor >= 0.02) regions.push({ start: cursor, end: duration });
  const merged: Interval[] = [];
  for (const region of regions) {
    const last = merged.at(-1);
    if (last && region.start - last.end < mergeGap) last.end = region.end;
    else merged.push({ ...region });
  }
  while (merged.length > MAX_REGIONS) {
    let index = 0;
    for (let i = 1; i < merged.length - 1; i++)
      if (merged[i + 1].start - merged[i].end < merged[index + 1].start - merged[index].end) index = i;
    merged[index].end = merged[index + 1].end;
    merged.splice(index + 1, 1);
  }
  return merged;
}

export type BlockOptions = { minSeconds: number; maxSeconds: number; breakSeconds: number };

/**
 * Merge speech regions into editing blocks of roughly `minSeconds`–`maxSeconds`. Runs are cut recursively at
 * their longest pause, preferring cuts that leave both sides at least `minSeconds`; a run that already fits is
 * still cut at a paragraph-length pause (`breakSeconds`). A single region longer than the maximum stays whole.
 */
export function groupRegions(regions: Interval[], options: BlockOptions): Interval[] {
  const split = (run: Interval[]): Interval[][] => {
    if (run.length < 2) return [run];
    const first = run[0].start;
    const last = run[run.length - 1].end;
    let best = -1;
    let fallback = 1;
    for (let index = 1; index < run.length; index++) {
      const gap = run[index].start - run[index - 1].end;
      if (gap > run[fallback].start - run[fallback - 1].end) fallback = index;
      const balanced =
        run[index - 1].end - first >= options.minSeconds && last - run[index].start >= options.minSeconds;
      if (balanced && (best < 0 || gap > run[best].start - run[best - 1].end)) best = index;
    }
    const paragraph = best >= 0 && run[best].start - run[best - 1].end >= options.breakSeconds;
    if (last - first <= options.maxSeconds && !paragraph) return [run];
    const cut = best >= 0 ? best : fallback;
    return [...split(run.slice(0, cut)), ...split(run.slice(cut))];
  };
  if (!regions.length) return [];
  return split(regions.toSorted((a, b) => a.start - b.start)).map((run) => ({
    start: run[0].start,
    end: run[run.length - 1].end,
  }));
}

/** Split at sentence ends, retaining punctuation and Unicode characters within the TTS limit. */
export function splitText(text: string): string[] {
  const sentences = text.match(/[^。！？!?；;\n]*[。！？!?；;\n]+|[^。！？!?；;\n]+$/gu) ?? [];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    for (const character of sentence) {
      if (current.length + character.length > LISTENING_LIMITS.SPEECH_CHARS) {
        if (current.trim()) chunks.push(current.trim());
        current = '';
      }
      current += character;
    }
    if (current.length >= 1800) {
      chunks.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function pauses(seconds: number, prefix: string): ListeningSegment[] {
  const result: ListeningSegment[] = [];
  for (let left = round(seconds); left >= 0.1; left = round(left - 600))
    result.push({ id: `${prefix}-${result.length + 1}`, type: 'pause', seconds: Math.min(left, 600) });
  return result;
}

type PreparedRegion = Region & { speech: string[] };
type Group = { regions: PreparedRegion[]; plays: number; gapBetweenPlays: number; gapAfter: number };
const transcript = (group: Group): string =>
  group.regions.every((region) => region.speech.length)
    ? group.regions
        .map((region) => region.text)
        .join('')
        .normalize('NFKC')
        .replace(/[\p{P}\p{S}\p{Z}\s]/gu, '')
    : '';

/** Build an editable draft; only complete, identical speech transcripts qualify as repeated plays. */
export function buildProject(regions: Region[], options: StructureOptions): ListeningProject {
  if (options.mode === 'clip') {
    // Silence detection is navigation only: every source sample, including room noise,
    // belongs to exactly one clip. Never regenerate original pauses as digital silence.
    const sections: ListeningSection[] = [];
    let cursor = 0;
    regions.forEach((region, index) => {
      if (!sections.length || region.start - (regions[index - 1]?.end ?? 0) >= options.sectionGap)
        sections.push({ id: `part-${sections.length + 1}`, plays: 1, gapBetweenPlays: 0, gapAfter: 0, segments: [] });
      const section = sections[sections.length - 1];
      const end = index === regions.length - 1 ? options.duration : region.end;
      section.segments.push({
        id: `${section.id}-c${section.segments.length + 1}`,
        type: 'clip',
        path: options.audioPath,
        start: cursor,
        end,
        ...(region.text?.trim() ? { transcript: { text: region.text.trim(), source: 'auto', verified: false } } : {}),
        ...(region.warnings?.length ? { warnings: region.warnings } : {}),
      });
      cursor = end;
    });
    return listeningProjectSchema.parse({ version: 1, title: options.title, sourceAudio: options.audioPath, sections });
  }
  const prepared: PreparedRegion[] = regions.map((region) => ({
    ...region,
    speech: options.mode === 'speech' && !region.warnings?.length ? splitText(region.text ?? '') : [],
  }));
  // Reserve room for all pauses. Oversized transcripts remain intact in the report and original audio.
  let count = prepared.reduce((sum, region) => sum + Math.max(1, region.speech.length), 0);
  const budget = LISTENING_LIMITS.SEGMENTS - regions.length - 20;
  for (const region of prepared.toSorted((a, b) => b.speech.length - a.speech.length)) {
    if (count <= budget) break;
    count -= Math.max(0, region.speech.length - 1);
    region.speech = [];
  }
  prepared.forEach((region, index) => {
    if (region.speech.length) return;
    // Padding comes out of surrounding silence instead of lengthening the finished track.
    region.start = round(
      Math.max(0, region.start - Math.min(options.padding, (region.start - (regions[index - 1]?.end ?? 0)) / 2))
    );
    region.end = round(
      Math.min(
        options.duration,
        region.end + Math.min(options.padding, ((regions[index + 1]?.start ?? options.duration) - region.end) / 2)
      )
    );
  });
  const groups: Group[] = [];
  prepared.forEach((region, index) => {
    const originalGap = index ? regions[index].start - regions[index - 1].end : Infinity;
    if (originalGap >= options.sectionGap || !groups.length) {
      if (groups.length) groups[groups.length - 1].gapAfter = round(region.start - prepared[index - 1].end);
      groups.push({ regions: [region], plays: 1, gapBetweenPlays: 0, gapAfter: 0 });
    } else groups[groups.length - 1].regions.push(region);
  });
  const collapsed: Group[] = [];
  for (const group of groups) {
    const previous = collapsed.at(-1);
    const text = transcript(group);
    if (
      previous &&
      previous.plays < 5 &&
      text.length >= 20 &&
      text === transcript(previous) &&
      previous.gapAfter <= 600 &&
      (previous.plays === 1 || Math.abs(previous.gapBetweenPlays - previous.gapAfter) < 0.1)
    ) {
      previous.plays++;
      previous.gapBetweenPlays = previous.gapAfter;
      previous.gapAfter = group.gapAfter;
    } else collapsed.push(group);
  }
  const sections: ListeningSection[] = [];
  const addSilence = (seconds: number, id: string): void => {
    const segments = pauses(seconds, id);
    if (segments.length) sections.push({ id, plays: 1, gapBetweenPlays: 0, gapAfter: 0, segments });
  };
  addSilence(prepared[0]?.start ?? 0, 'leading');
  collapsed.forEach((group, index) => {
    const id = `part-${index + 1}`;
    const segments: ListeningSegment[] = [];
    group.regions.forEach((region, position) => {
      if (position) segments.push(...pauses(region.start - group.regions[position - 1].end, `${id}-p${position}`));
      if (region.speech.length) {
        region.speech.forEach((text, part) =>
          segments.push({ id: `${id}-s${position + 1}-${part + 1}`, type: 'speech', text })
        );
      } else {
        segments.push({
          id: `${id}-c${position + 1}`,
          type: 'clip',
          path: options.audioPath,
          start: region.start,
          end: region.end,
          ...(region.text?.trim() ? { transcript: { text: region.text.trim(), source: 'auto', verified: false } } : {}),
          ...(region.warnings?.length ? { warnings: region.warnings } : {}),
        });
      }
    });
    sections.push({
      id,
      plays: group.plays,
      gapBetweenPlays: group.gapBetweenPlays,
      gapAfter: group.gapAfter <= 600 ? group.gapAfter : 0,
      segments,
    });
    if (group.gapAfter > 600) addSilence(group.gapAfter, `${id}-after`);
  });
  addSilence(options.duration - (prepared.at(-1)?.end ?? options.duration), 'trailing');
  return listeningProjectSchema.parse({ version: 1, title: options.title, sections });
}
