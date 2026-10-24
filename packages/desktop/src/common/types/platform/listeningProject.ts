/** Browser-safe listening track project contract shared by the host renderer and future editors. */
import { z } from 'zod';
import { AUDIO_VOICES, HERTZ_OFFSET, PERCENT_OFFSET, type AudioTaskView } from './audioTools.ts';

export const LISTENING_LIMITS = {
  SEGMENTS: 500,
  SPEECH_CHARS: 2000,
  TRACK_SECONDS: 90 * 60,
  PROJECT_BYTES: 2 * 1024 * 1024,
} as const;

const id = z.string().regex(/^[\w-]{1,64}$/);
const prosody = {
  voice: z.enum(AUDIO_VOICES).optional(),
  rate: z.string().regex(PERCENT_OFFSET).optional(),
  volume: z.string().regex(PERCENT_OFFSET).optional(),
  pitch: z.string().regex(HERTZ_OFFSET).optional(),
};
const sourceRange = z
  .object({ path: z.string().min(1).max(4096), start: z.number().min(0), end: z.number().positive() })
  .strict()
  .refine((range) => range.end > range.start, { message: 'end must be after start', path: ['end'] });
const transcriptSchema = z
  .object({ text: z.string().max(50000), verified: z.boolean().default(false), source: z.enum(['auto', 'teacher']) })
  .strict();
const segmentSchema = z.discriminatedUnion('type', [
  z
    .object({
      id,
      type: z.literal('speech'),
      speaker: z.string().trim().min(1).max(40).optional(),
      text: z.string().trim().min(1).max(LISTENING_LIMITS.SPEECH_CHARS),
      ...prosody,
      replaces: sourceRange.optional(),
    })
    .strict(),
  z
    .object({
      id,
      type: z.literal('pause'),
      seconds: z.number().min(0.1).max(600),
      note: z.string().max(200).optional(),
    })
    .strict(),
  z.object({ id, type: z.literal('chime'), preset: z.enum(['start', 'end']).default('start') }).strict(),
  z
    .object({
      id,
      type: z.literal('clip'),
      path: z.string().min(1).max(4096),
      start: z.number().min(0),
      end: z.number().positive(),
      note: z.string().max(200).optional(),
      transcript: transcriptSchema.optional(),
      warnings: z.array(z.string().max(100)).max(100).optional(),
    })
    .strict()
    .refine((clip) => clip.end > clip.start, { message: 'end must be after start', path: ['end'] }),
]);
const sectionSchema = z
  .object({
    id,
    label: z.string().trim().max(200).optional(),
    plays: z.number().int().min(1).max(5).default(1),
    gapBetweenPlays: z.number().min(0).max(600).default(5),
    gapAfter: z.number().min(0).max(600).default(3),
    segments: z.array(segmentSchema).min(1),
  })
  .strict();

export const listeningProjectSchema = z
  .object({
    version: z.literal(1),
    title: z.string().trim().min(1).max(200),
    /** Original recording whose audio format is retained; clip ranges include all original pauses. */
    sourceAudio: z.string().min(1).max(4096).optional(),
    defaults: z
      .object({
        voice: z.enum(AUDIO_VOICES).default('HiuMaan'),
        rate: z.string().regex(PERCENT_OFFSET).default('+0%'),
        volume: z.string().regex(PERCENT_OFFSET).default('+0%'),
        pitch: z.string().regex(HERTZ_OFFSET).default('+0Hz'),
      })
      .strict()
      .default({ voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' }),
    /** Pronunciation fixes: `match` is replaced by `speak` in TTS input only; subtitles and scripts keep the original. */
    lexicon: z
      .array(z.object({ match: z.string().min(1).max(100), speak: z.string().min(1).max(100) }).strict())
      .max(500)
      .default([]),
    sections: z.array(sectionSchema).min(1),
  })
  .strict()
  .superRefine((project, context) => {
    const seen = new Set<string>();
    let count = 0;
    project.sections.forEach((section, index) => {
      if (seen.has(section.id))
        context.addIssue({ code: 'custom', message: `duplicate id ${section.id}`, path: ['sections', index, 'id'] });
      seen.add(section.id);
      section.segments.forEach((segment, position) => {
        count++;
        if (seen.has(segment.id))
          context.addIssue({
            code: 'custom',
            message: `duplicate id ${segment.id}`,
            path: ['sections', index, 'segments', position, 'id'],
          });
        seen.add(segment.id);
      });
    });
    if (count > LISTENING_LIMITS.SEGMENTS)
      context.addIssue({
        code: 'custom',
        message: `at most ${LISTENING_LIMITS.SEGMENTS} segments`,
        path: ['sections'],
      });
  });

export type ListeningProject = z.infer<typeof listeningProjectSchema>;
export type ListeningSection = ListeningProject['sections'][number];
export type ListeningSegment = ListeningSection['segments'][number];
/** One rendered piece of the final track, in seconds from the start of `track.mp3`. */
export type ListeningTimelineEntry = {
  sectionId: string;
  segmentId?: string;
  type: ListeningSegment['type'] | 'gap';
  play: number;
  start: number;
  end: number;
};
export type ListeningTimeline = { durationSeconds: number; entries: ListeningTimelineEntry[] };
/** A speech segment whose re-transcription does not closely match its script text. */
export type ListeningQaIssue = { segmentId: string; expected: string; heard: string; similarity: number };
/** Editor view of one speech segment's cache and QA state; keys change whenever text or voice settings change. */
export type ListeningSegmentState = {
  key: string;
  cached: boolean;
  transcript?: z.infer<typeof transcriptSchema>;
  warnings?: string[];
  qa?: { heard: string; similarity: number; accepted: boolean };
};
/** Everything the listening editor needs for one project file. `revision` guards concurrent saves. */
export type ListeningState = {
  path: string;
  revision: string;
  project?: ListeningProject;
  /** Validation messages when the file on disk is not a valid project. */
  details?: string[];
  segments: Record<string, ListeningSegmentState>;
  qaThreshold: number;
  tasks: AudioTaskView[];
};
