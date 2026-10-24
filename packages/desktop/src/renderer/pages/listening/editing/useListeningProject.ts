import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';
import {
  listeningApi,
  listeningError,
  type ListeningError,
  type ListeningTarget,
  type ListeningTaskStart,
  type ReplacementRequest,
} from '@/renderer/pages/listening/data/api';

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
  /** Save pending edits, then synthesize a before/after preview; resolves to the preview task id. */
  previewReplacement: (request: ReplacementRequest) => Promise<string | undefined>;
  /** Splice a completed preview into the saved project. */
  applyReplacement: (previewId: string) => Promise<boolean>;
  /** Save pending edits, then package the project with its source audio; resolves to the export task id. */
  bundle: () => Promise<string | undefined>;
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
  const draftRef = useRef<ListeningProject | undefined>(undefined);
  draftRef.current = draft;
  /** Latest adopted state, so actions that save first can read the new revision. */
  const stateRef = useRef<ListeningState | undefined>(undefined);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const key = target ? `${target.conversation_id}\0${target.path}` : '';

  /** Adopt a fresh server state; the working copy follows it unless the teacher is mid-edit. */
  const adopt = useCallback((next: ListeningState, replaceDraft = !dirtyRef.current) => {
    stateRef.current = next;
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
  /** Bumped when a background poll fails, so the next poll is still scheduled. */
  const [pollFailures, setPollFailures] = useState(0);
  useEffect(() => {
    if (!target || loadError) return;
    // Ignore a response that arrives after the target changed or the editor closed.
    let cancelled = false;
    const timer = setTimeout(
      () => {
        listeningApi
          .load(target)
          .then((next) => {
            if (!cancelled) adopt(next);
          })
          .catch(() => {
            // A transient failure must not stop polling, or a finished render would look stuck.
            if (!cancelled) setPollFailures((count) => count + 1);
          });
      },
      active ? ACTIVE_POLL_MS : IDLE_POLL_MS
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Re-arm after every state change or failed poll so polling continues while the editor is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the target.
  }, [key, state, active, loadError, adopt, pollFailures]);

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
      const submitted = draft;
      // Keep edits made while the save was in flight: the draft is replaced only if it is still the saved one.
      const saved = await run(() => listeningApi.save(target, submitted, revision), false);
      if (saved) {
        setConflict(false);
        if (draftRef.current === submitted) {
          setDraft(stateRef.current?.project);
          setDirty(false);
        }
      }
      return saved;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the target.
    [key, draft, state, run]
  );

  /** Start a host task against the saved project, saving the teacher's edits first like `render`. */
  const startTask = async (
    begin: (target: ListeningTarget, revision: string) => Promise<ListeningTaskStart>
  ): Promise<string | undefined> => {
    if (!target || !state) return undefined;
    // A successful save adopts the new state, so `stateRef` then holds the saved revision.
    if (dirty && !(await save())) return undefined;
    let taskId: string | undefined;
    const revision = stateRef.current?.revision ?? state.revision;
    await run(async () => {
      const started = await begin(target, revision);
      taskId = started.taskId;
      return started.state;
    }, false);
    return taskId;
  };

  return {
    state,
    draft,
    dirty,
    loadError,
    busy,
    conflict,
    edit: (change) => {
      // Update the ref eagerly so a save resolving in the same tick sees the newer draft.
      const next = draftRef.current ? change(draftRef.current) : draftRef.current;
      draftRef.current = next;
      setDraft(next);
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
    previewReplacement: (request) =>
      startTask((current, revision) => listeningApi.previewReplacement(current, revision, request)),
    applyReplacement: async (previewId) => {
      if (!target || !state) return false;
      return run(() => listeningApi.applyReplacement(target, state.revision, previewId), true);
    },
    bundle: () => startTask((current, revision) => listeningApi.bundle(current, revision)),
    reload,
  };
}
