import { z } from 'zod';

/** Cached QA transcript of one synthesized segment; `accepted` records a teacher's sign-off. */
export const qaRecordSchema = z.object({ heard: z.string(), accepted: z.boolean().optional() });
export type QaRecord = z.infer<typeof qaRecordSchema>;

/** Compare what the TTS output sounds like against the script, ignoring punctuation, spacing and width. */
export const QA_THRESHOLD = 0.9;
const compact = (text: string): string[] => [...text.normalize('NFKC').replace(/[\p{P}\p{S}\p{Z}\s]/gu, '')];

function distance(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

/** Character-level similarity in [0, 1]; empty against empty counts as identical. */
export function similarity(expected: string, heard: string): number {
  const a = compact(expected);
  const b = compact(heard);
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : Number((1 - distance(a, b) / longest).toFixed(3));
}

/** Best match against either the script or the lexicon-adjusted text actually sent to TTS. */
export function speechSimilarity(original: string, spoken: string, heard: string): number {
  return Math.max(similarity(original, heard), original === spoken ? 0 : similarity(spoken, heard));
}
