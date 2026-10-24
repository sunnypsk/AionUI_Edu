import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListeningProject } from '@/common/types/platform/listeningProject';
import type { ListeningError, ListeningTarget } from '@/renderer/pages/listening/data/api';
import {
  record,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from '@/renderer/pages/listening/editing/history';
import { useListeningProject, type ListeningEditorModel } from '@/renderer/pages/listening/editing/useListeningProject';
import { isSavable } from '@/renderer/pages/listening/editing/validation';

export const AUTOSAVE_MS = 1500;
export type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';
export type ProjectDraft = ListeningEditorModel & {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  saveState: SaveState;
  /** Save pending edits now; resolves true when nothing is left unsaved. */
  flush: () => Promise<boolean>;
};

const same = (a?: ListeningProject, b?: ListeningProject): boolean =>
  a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

/**
 * The editor's working copy: undoable edits and a revision-checked autosave 1.5 s after the last edit.
 * A conflict pauses autosave until the teacher reloads or overwrites.
 */
export function useProjectDraft(
  target: ListeningTarget | undefined,
  onError: (error: ListeningError) => void
): ProjectDraft {
  const model = useListeningProject(target, onError);
  const [history, setHistory] = useState<History<ListeningProject | undefined>>({
    past: [],
    present: undefined,
    future: [],
  });
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const modelRef = useRef(model);
  modelRef.current = model;

  // A draft replaced from outside (load, reload, agent change) starts a fresh history; a save that
  // returns the same content keeps it so undo still works after autosave.
  useEffect(() => {
    setHistory((current) =>
      same(current.present, model.draft)
        ? { ...current, present: model.draft }
        : { past: [], present: model.draft, future: [] }
    );
  }, [model.draft]);

  const persist = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    const current = modelRef.current;
    if (!current.dirty) return true;
    if (current.conflict) return false;
    if (!current.draft || !isSavable(current.draft)) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    setSaving(true);
    try {
      const saved = await current.save();
      setInvalid(!saved);
      return saved;
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!model.dirty || model.conflict) return;
    timer.current = setTimeout(() => void persist(), AUTOSAVE_MS);
    return () => clearTimeout(timer.current);
  }, [model.draft, model.dirty, model.conflict, persist]);

  const apply = (next: History<ListeningProject | undefined>) => {
    if (next === history || !next.present) return;
    setHistory(next);
    model.edit(() => next.present!);
  };

  const saveState: SaveState = model.conflict
    ? 'conflict'
    : saving
      ? 'saving'
      : invalid && model.dirty
        ? 'error'
        : model.dirty
          ? 'pending'
          : 'saved';

  return {
    ...model,
    edit: (change) => {
      const current = modelRef.current.draft;
      if (!current) return;
      const next = change(current);
      if (next === current) return;
      setInvalid(false);
      setHistory((value) => record(value, next));
      model.edit(() => next);
    },
    reload: async () => {
      clearTimeout(timer.current);
      setInvalid(false);
      await model.reload();
    },
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo: () => apply(undoHistory(history)),
    redo: () => apply(redoHistory(history)),
    saveState,
    flush: persist,
  };
}
