/** Linear undo history for the editor's working copy. */
export type History<T> = { past: T[]; present: T; future: T[] };
export const HISTORY_LIMIT = 100;

/** Push a new present state, dropping the oldest past state beyond the limit and clearing redo. */
export function record<T>(history: History<T>, next: T): History<T> {
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo<T>(history: History<T>): History<T> {
  if (!history.past.length) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}
