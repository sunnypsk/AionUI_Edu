import type { ListeningProject, ListeningSection, ListeningSegment } from '@/common/types/platform/listeningProject';

export type NewSegmentType = 'speech' | 'pause' | 'chime' | 'clip';

/** Short id that is unique within the project and matches the host's `[\w-]{1,64}` rule. */
export function newId(project: ListeningProject, prefix: string): string {
  const used = new Set(project.sections.flatMap((section) => [section.id, ...section.segments.map((item) => item.id)]));
  for (let attempt = 0; ; attempt++) {
    const id = `${prefix}-${crypto.randomUUID().slice(0, attempt < 5 ? 6 : 12)}`;
    if (!used.has(id)) return id;
  }
}

/** A blank segment of `type` with a fresh id, as inserted by the add buttons. */
export function newSegment(project: ListeningProject, type: NewSegmentType): ListeningSegment {
  if (type === 'pause') return { id: newId(project, 'pause'), type, seconds: 5 };
  if (type === 'chime') return { id: newId(project, 'chime'), type, preset: 'start' };
  if (type === 'clip') {
    const source = project.sections.flatMap((section) => section.segments).find((segment) => segment.type === 'clip');
    return { id: newId(project, 'clip'), type, path: source?.path ?? '', start: 0, end: 1 };
  }
  return { id: newId(project, 'line'), type, text: '' };
}

const mapSection = (
  project: ListeningProject,
  sectionId: string,
  change: (section: ListeningSection) => ListeningSection
): ListeningProject => ({
  ...project,
  sections: project.sections.map((section) => (section.id === sectionId ? change(section) : section)),
});

function move<T>(items: T[], index: number, offset: -1 | 1): T[] {
  const target = index + offset;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export const draft = {
  updateSection: (
    project: ListeningProject,
    sectionId: string,
    patch: Partial<Omit<ListeningSection, 'id' | 'segments'>>
  ) => mapSection(project, sectionId, (section) => ({ ...section, ...patch })),
  addSection: (project: ListeningProject): ListeningProject => ({
    ...project,
    sections: [
      ...project.sections,
      {
        id: newId(project, 'part'),
        plays: 1,
        gapBetweenPlays: 5,
        gapAfter: 3,
        segments: [newSegment(project, 'speech')],
      },
    ],
  }),
  removeSection: (project: ListeningProject, sectionId: string): ListeningProject => ({
    ...project,
    sections: project.sections.filter((section) => section.id !== sectionId),
  }),
  moveSection: (project: ListeningProject, sectionId: string, offset: -1 | 1): ListeningProject => ({
    ...project,
    sections: move(
      project.sections,
      project.sections.findIndex((section) => section.id === sectionId),
      offset
    ),
  }),
  /** Replace a segment, keeping its id and type; callers pass fields valid for that type. */
  updateSegment: (project: ListeningProject, sectionId: string, segment: ListeningSegment): ListeningProject =>
    mapSection(project, sectionId, (section) => ({
      ...section,
      segments: section.segments.map((item) => (item.id === segment.id ? segment : item)),
    })),
  addSegment: (project: ListeningProject, sectionId: string, type: NewSegmentType): ListeningProject =>
    mapSection(project, sectionId, (section) => ({
      ...section,
      segments: [...section.segments, newSegment(project, type)],
    })),
  removeSegment: (project: ListeningProject, sectionId: string, segmentId: string): ListeningProject =>
    mapSection(project, sectionId, (section) => ({
      ...section,
      segments: section.segments.filter((item) => item.id !== segmentId),
    })),
  moveSegment: (project: ListeningProject, sectionId: string, segmentId: string, offset: -1 | 1): ListeningProject =>
    mapSection(project, sectionId, (section) => ({
      ...section,
      segments: move(
        section.segments,
        section.segments.findIndex((item) => item.id === segmentId),
        offset
      ),
    })),
  setLexicon: (project: ListeningProject, lexicon: ListeningProject['lexicon']): ListeningProject => ({
    ...project,
    lexicon,
  }),
};

/** Signed percentage offsets offered for speaking speed; Edge TTS accepts any `[+-]N%`. */
export const RATE_OPTIONS = ['-30%', '-20%', '-10%', '+0%', '+10%', '+20%'] as const;

/** Format seconds as `m:ss` for players and status lines. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
