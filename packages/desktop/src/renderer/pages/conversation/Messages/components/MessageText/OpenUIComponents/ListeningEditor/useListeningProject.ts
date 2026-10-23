import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';
import { listeningApi, listeningError, type ListeningError, type ListeningTarget } from './api';

const ACTIVE_POLL_MS = 1500;
const IDLE_POLL_MS = 5000;

export type ListeningEditorModel = {
  state?: ListeningState;
  /** The teacher's working copy; equals `state.project` until edited. */
  draft?: ListeningProject;
  dirty: boolean;
  loadError?: ListeningError;
  busy: boolean;
  /** Set when a save found the file changed by the agent or another window. */
  conflict: boolean;
  edit: (change: (project: ListeningProject) => ListeningProject) => void;
  save: (options?: { overwrite?: boolean }) => Promise<boolean>;
  render: (onlySections?: string[]) => Promise<void>;
  cancel: (taskId: string) => Promise<void>;
  acceptQa: (segmentId: string, accepted: boolean) => Promise<void>;
  reload: () => Promise<void>;
};

const isActive = (state?: ListeningState): boolean =>
  !!state?.tasks.some((task) => task.status === 'queued' || task.status === 'running');

/**
 * Editor state for one project file. Polls quickly while a render runs and slowly otherwise, adopting
 * changes made by the agent whenever the teacher has no unsaved edits.
 */
export function useListeningProject(
  target: ListeningTarget | undefined,
  onError: (error: ListeningError) => void
): ListeningEditorModel {
  const [state, setState] = useState<ListeningState>();
  const [draft, setDraft] = useState<ListeningProject>();
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<ListeningError>();
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const key = target ? `${target.conversation_id}\0${target.path}` : '';

  /** Adopt a fresh server state; the working copy follows it unless the teacher is mid-edit. */
  const adopt = useCallback((next: ListeningState, replaceDraft = !dirtyRef.current) => {
    setState(next);
    if (replaceDraft) {
      setDraft(next.project);
      setDirty(false);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!target) return;
    try {
      adopt(await listeningApi.load(target), true);
      setLoadError(undefined);
      setConflict(false);
    } catch (error) {
      setLoadError(listeningError(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the target.
  }, [key, adopt]);

  useEffect(() => {
    setState(undefined);
    setDraft(undefined);
    setDirty(false);
    void reload();
  }, [reload]);

  const active = isActive(state);
  useEffect(() => {
    if (!target || loadError) return;
    const timer = setTimeout(
      () => {
        listeningApi
          .load(target)
          .then((next) => adopt(next))
          .catch(() => {});
      },
      active ? ACTIVE_POLL_MS : IDLE_POLL_MS
    );
    return () => clearTimeout(timer);
    // Re-arm after every state change so polling continues for as long as the editor is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the target.
  }, [key, state, active, loadError, adopt]);

  const run = useCallback(
    async (action: () => Promise<ListeningState>, replaceDraft: boolean): Promise<boolean> => {
      setBusy(true);
      try {
        adopt(await action(), replaceDraft);
        return true;
      } catch (error) {
        const failure = listeningError(error);
        if (failure.code === 'AUDIO_PROJECT_CONFLICT') setConflict(true);
        else onErrorRef.current(failure);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [adopt]
  );

  const save = useCallback(
    async (options?: { overwrite?: boolean }): Promise<boolean> => {
      if (!target || !draft || !state) return false;
      let revision = state.revision;
      if (options?.overwrite) {
        try {
          revision = (await listeningApi.load(target)).revision;
        } catch (error) {
          onErrorRef.current(listeningError(error));
          return false;
        }
      }
      const saved = await run(() => listeningApi.save(target, draft, revision), true);
      if (saved) setConflict(false);
      return saved;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the target.
    [key, draft, state, run]
  );

  return {
    state,
    draft,
    dirty,
    loadError,
    busy,
    conflict,
    edit: (change) => {
      setDraft((current) => (current ? change(current) : current));
      setDirty(true);
    },
    save,
    render: async (onlySections) => {
      if (!target) return;
      // Render what the teacher sees: unsaved edits are saved first.
      if (dirty && !(await save())) return;
      await run(() => listeningApi.render(target, onlySections), false);
    },
    cancel: async (taskId) => {
      if (target) await run(() => listeningApi.cancel(target, taskId), false);
    },
    acceptQa: async (segmentId, accepted) => {
      if (target) await run(() => listeningApi.acceptQa(target, segmentId, accepted), false);
    },
    reload,
  };
}
