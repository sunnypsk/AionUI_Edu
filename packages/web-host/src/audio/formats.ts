import type { AudioFormat, AudioSegment } from './types.js';

/** Repair coarse model timings without promising precise alignment. */
export function normalizeSegments(segments: AudioSegment[], duration: number): AudioSegment[] {
  const result: AudioSegment[] = [];
  for (const segment of [...segments].toSorted((a, b) => a.startSecond - b.startSecond)) {
    if (!segment.text?.trim() || !Number.isFinite(segment.startSecond) || !Number.isFinite(segment.endSecond)) continue;
    const startSecond = Math.max(0, result.at(-1)?.endSecond ?? 0, segment.startSecond);
    const endSecond = Math.min(duration, segment.endSecond);
    if (endSecond > startSecond) result.push({ text: segment.text.trim(), startSecond, endSecond });
    else if (
      result.length &&
      segment.startSecond >= 0 &&
      segment.startSecond < duration &&
      segment.endSecond > segment.startSecond
    ) {
      // A coarse timestamp may put new words fully inside the preceding cue. Keep the words.
      result[result.length - 1].text += segment.text.trim();
    }
  }
  return result;
}
const compact = (text: string): string => text.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '');
/** Merge chunk-local times; only remove repeated words within the actual overlapping audio. */
export function mergeSegments(chunks: { start: number; segments: AudioSegment[] }[], duration: number): AudioSegment[] {
  const merged: AudioSegment[] = [];
  let previousEnd = 0;
  for (const chunk of chunks) {
    const local = chunk.segments.map((segment) => ({
      ...segment,
      startSecond: segment.startSecond + chunk.start,
      endSecond: segment.endSecond + chunk.start,
    }));
    const tail = merged
      .filter((segment) => segment.endSecond >= chunk.start)
      .map((segment) => segment.text)
      .join('');
    let prefix = '';
    const overlapping = local.filter((segment) => segment.startSecond <= previousEnd);
    for (const segment of overlapping) prefix += segment.text;
    let duplicate = 0;
    // Compare original text as well as punctuation-normalized cues, preserving intentional repetition outside the overlap.
    for (let count = Math.min(tail.length, prefix.length); count >= 2; count--) {
      if (compact(tail.slice(-count)) && compact(tail.slice(-count)) === compact(prefix.slice(0, count))) {
        duplicate = count;
        break;
      }
    }
    for (const segment of local) {
      if (duplicate > 0 && segment.startSecond <= previousEnd) {
        const removed = Math.min(duplicate, segment.text.length);
        segment.text = segment.text.slice(removed);
        duplicate -= removed;
      }
      if (segment.text.trim()) merged.push(segment);
    }
    previousEnd = Math.max(previousEnd, ...local.map((segment) => segment.endSecond));
  }
  return normalizeSegments(merged, duration);
}
function timestamp(seconds: number, separator: string): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`;
}
/** Serialize validated transcript segments into the user-requested artifact format. */
export function formatTranscript(format: AudioFormat, segments: AudioSegment[]): string {
  if (format === 'txt') return segments.map((segment) => segment.text).join('\n') + '\n';
  if (format === 'json')
    return JSON.stringify({ text: segments.map((segment) => segment.text).join(''), segments }, null, 2) + '\n';
  const separator = format === 'srt' ? ',' : '.';
  return (
    (format === 'vtt' ? 'WEBVTT\n\n' : '') +
    segments
      .map(
        (segment, index) =>
          `${format === 'srt' ? `${index + 1}\n` : ''}${timestamp(segment.startSecond, separator)} --> ${timestamp(segment.endSecond, separator)}\n${segment.text}`
      )
      .join('\n\n') +
    '\n'
  );
}
