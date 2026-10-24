import type { ListeningProject } from '@/common/types/platform/listeningProject';

/** Blank speech lines or pronunciation entries the host would reject; caught before saving. */
export const hasBlankFields = (project: ListeningProject): boolean =>
  project.lexicon.some((entry) => !entry.match || !entry.speak) ||
  project.sections.some((section) =>
    section.segments.some((segment) => segment.type === 'speech' && !segment.text.trim())
  );

/** First clip with a missing path or an empty range, so the editor can reveal it. */
export const invalidClip = (project: ListeningProject): string | undefined =>
  project.sections
    .flatMap((section) => section.segments)
    .find(
      (segment) =>
        segment.type === 'clip' && (!segment.path.trim() || segment.start < 0 || segment.end <= segment.start)
    )?.id;

/** First blank speech line, so the editor can reveal it. */
export const blankLine = (project: ListeningProject): string | undefined =>
  project.sections
    .flatMap((section) => section.segments)
    .find((segment) => segment.type === 'speech' && !segment.text.trim())?.id;

/** Whether the host would accept this draft (title, lines, clips and lexicon). */
export const isSavable = (project: ListeningProject): boolean =>
  !!project.title.trim() && !hasBlankFields(project) && !invalidClip(project);
