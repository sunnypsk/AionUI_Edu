import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { loadState, saveState } from './api';
import type { OpenUiSavedState } from './types';

/** Reserved saved-state key recording when the user submitted a block back to the assistant. */
export const SUBMITTED_AT_KEY = '__aionui_submitted_at';

/** The submission time stored in a block's saved state, if the block was submitted. */
export const readSubmittedAt = (state: Record<string, unknown> | undefined): number | undefined => {
  const value = state?.[SUBMITTED_AT_KEY];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

/** Form state as the program sees it, without the reserved submission marker. */
export const withoutSubmission = (state: Record<string, unknown>): Record<string, unknown> => {
  if (!(SUBMITTED_AT_KEY in state)) return state;
  const { [SUBMITTED_AT_KEY]: _submittedAt, ...rest } = state;
  return rest;
};

type Snapshot = {
  saved: OpenUiSavedState | null;
  restored: Record<string, unknown> | undefined;
  error: 'load' | 'save' | 'conflict' | null;
};

/** An immutable owner prevents an old message's asynchronous writes from touching a new message. */
export class SavedStateSession {
  private snapshot: Snapshot = { saved: null, restored: undefined, error: null };
  private listeners = new Set<() => void>();
  private draft: Record<string, unknown> | null = null;
  private pending: Promise<void> | null = null;
  private pendingState: Record<string, unknown> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readController: AbortController | null = null;
  constructor(private readonly path: string | null) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = (): Snapshot => this.snapshot;
  current = (): Record<string, unknown> => this.draft ?? this.pendingState ?? this.snapshot.saved?.state ?? {};
  dirty = (): boolean => Boolean(this.draft || this.pending);
  idle = (): boolean => !this.dirty() && this.listeners.size === 0;
  resume = (): void => {
    if (this.snapshot.saved) this.publish({ ...this.snapshot, restored: this.current() });
  };
  private publish(next: Snapshot): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
  reload = async (retainDraft = false): Promise<void> => {
    if (!this.path || this.pending || (this.draft && !retainDraft)) return;
    this.readController?.abort();
    const controller = new AbortController();
    this.readController = controller;
    try {
      const saved = await loadState(this.path, controller.signal);
      if (!controller.signal.aborted) this.publish({ saved, restored: saved.state, error: null });
    } catch {
      if (!controller.signal.aborted) this.publish({ ...this.snapshot, error: 'load' });
    }
  };
  update = (state: Record<string, unknown>): void => {
    if (!this.snapshot.saved || JSON.stringify(state) === JSON.stringify(this.current())) return;
    this.readController?.abort();
    this.draft = state;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 300);
  };
  flush = async (): Promise<void> => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) await this.pending;
    if (!this.path || !this.draft || !this.snapshot.saved) return;
    const state = this.draft;
    this.draft = null;
    this.pendingState = state;
    const write = saveState(this.path, this.snapshot.saved, state)
      .then((saved) => this.publish({ ...this.snapshot, saved, error: null }))
      .catch((reason: unknown) => {
        if (!this.draft) this.draft = state;
        this.publish({
          ...this.snapshot,
          error: isBackendHttpError(reason) && reason.status === 409 ? 'conflict' : 'save',
        });
        throw reason;
      });
    this.pending = write;
    try {
      await write;
    } finally {
      if (this.pending === write) {
        this.pending = null;
        this.pendingState = null;
      }
    }
    if (this.draft) await this.flush();
  };
  reapply = async (): Promise<void> => {
    await this.reload(true);
    if (this.snapshot.error) return;
    if (this.draft) this.publish({ ...this.snapshot, restored: this.draft });
    await this.flush();
  };
  dispose = (): void => {
    this.readController?.abort();
    if (this.timer) clearTimeout(this.timer);
    void this.flush().catch(() => {});
  };
}

const sessions = new Map<string, { owner: string; session: SavedStateSession }>();

export const hasOpenUiDrafts = (owner?: string): boolean =>
  Boolean(owner && [...sessions.values()].some((entry) => entry.owner === owner && entry.session.dirty()));

/** Preserve an unsaved or conflicting draft when its message is temporarily unmounted. */
export function getSavedStateSession(owner: string, path: string, program: string): SavedStateSession {
  const key = JSON.stringify([owner, path, program]);
  const existing = sessions.get(key);
  if (existing) {
    existing.session.resume();
    return existing.session;
  }
  if (sessions.size >= 100) {
    for (const [cachedKey, value] of sessions) {
      if (value.session.idle()) sessions.delete(cachedKey);
      if (sessions.size < 100) break;
    }
  }
  const session = new SavedStateSession(path);
  sessions.set(key, { owner, session });
  return session;
}

/** Finish every account-owned draft before rendering a newly selected conversation. */
export async function flushOpenUiDrafts(owner: string): Promise<void> {
  const results = await Promise.allSettled(
    [...sessions.values()]
      .filter((entry) => entry.owner === owner && entry.session.dirty())
      .map(({ session }) => session.flush())
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

/** Restore on focus, debounce edits, and flush pending edits when leaving the message. */
export function useSavedState(path: string | null, program: string, owner?: string) {
  const session = useMemo(
    () => (path && owner ? getSavedStateSession(owner, path, program) : new SavedStateSession(path)),
    [path, program, owner]
  );
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    void session.reload();
    const onFocus = () => {
      void session.reload();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!session.dirty()) return;
      void session.flush().catch(() => {});
      event.preventDefault();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('beforeunload', onBeforeUnload);
      session.dispose();
    };
  }, [session]);
  const retry = useCallback(() => {
    void session.reapply().catch(() => {});
  }, [session]);
  return { ...snapshot, current: session.current, update: session.update, flush: session.flush, reload: retry };
}
