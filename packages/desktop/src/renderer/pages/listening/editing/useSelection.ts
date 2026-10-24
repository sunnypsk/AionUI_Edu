import { useCallback, useMemo, useRef, useState } from 'react';
import type { ListeningProject } from '@/common/types/platform/listeningProject';

export type Selection =
  | { kind: 'none' }
  | { kind: 'section'; sectionId: string }
  /** Contiguous segments of one section, in project order. */
  | { kind: 'segments'; sectionId: string; ids: string[] }
  /** A time range inside one clip, in source seconds. */
  | { kind: 'range'; clipId: string; start: number; end: number };
export type ViewMode = 'script' | 'timeline';

const NONE: Selection = { kind: 'none' };

/** Drop a selection whose section or segments no longer exist (after delete, undo or reload). */
function prune(selection: Selection, project?: ListeningProject): Selection {
  if (selection.kind === 'none' || !project) return selection;
  if (selection.kind === 'section')
    return project.sections.some((section) => section.id === selection.sectionId) ? selection : NONE;
  if (selection.kind === 'range')
    return project.sections.some((section) => section.segments.some((segment) => segment.id === selection.clipId))
      ? selection
      : NONE;
  const section = project.sections.find((item) => item.id === selection.sectionId);
  const ids = selection.ids.filter((id) => section?.segments.some((segment) => segment.id === id));
  return ids.length ? (ids.length === selection.ids.length ? selection : { ...selection, ids }) : NONE;
}

/** Shared selection for the script and timeline views; shift-click extends from the last plain click. */
export function useSelection(project?: ListeningProject): {
  selection: Selection;
  select: (selection: Selection) => void;
  selectSegment: (sectionId: string, id: string, extend: boolean) => void;
} {
  const [raw, setRaw] = useState<Selection>(NONE);
  const anchor = useRef<{ sectionId: string; id: string } | undefined>(undefined);
  const selection = useMemo(() => prune(raw, project), [raw, project]);
  const select = useCallback((next: Selection) => {
    anchor.current = next.kind === 'segments' ? { sectionId: next.sectionId, id: next.ids[0] } : undefined;
    setRaw(next);
  }, []);
  const selectSegment = useCallback(
    (sectionId: string, id: string, extend: boolean) => {
      const section = project?.sections.find((item) => item.id === sectionId);
      const from = anchor.current;
      if (extend && section && from?.sectionId === sectionId) {
        const ids = section.segments.map((segment) => segment.id);
        const [low, high] = [ids.indexOf(from.id), ids.indexOf(id)].toSorted((a, b) => a - b);
        if (low >= 0) {
          setRaw({ kind: 'segments', sectionId, ids: ids.slice(low, high + 1) });
          return;
        }
      }
      anchor.current = { sectionId, id };
      setRaw({ kind: 'segments', sectionId, ids: [id] });
    },
    [project]
  );
  return { selection, select, selectSegment };
}
