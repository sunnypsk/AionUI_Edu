/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useReducer } from 'react';
import { EMPTY_SCENE } from './types';
import type { AnnotationScene } from './types';

export type HistoryState = {
  past: AnnotationScene[];
  present: AnnotationScene;
  future: AnnotationScene[];
};

export type HistoryAction =
  | { type: 'commit'; scene: AnnotationScene }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' };

export const INITIAL_HISTORY: HistoryState = { past: [], present: EMPTY_SCENE, future: [] };

/** Linear undo/redo: a new commit discards any redo branch. */
export const historyReducer = (state: HistoryState, action: HistoryAction): HistoryState => {
  switch (action.type) {
    case 'commit':
      return { past: [...state.past, state.present], present: action.scene, future: [] };
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { past: [...state.past, state.present], present: next, future: rest };
    }
    case 'reset':
      return INITIAL_HISTORY;
  }
};

/** Undoable annotation scene for the image editor. */
export const useAnnotationHistory = () => {
  const [state, dispatch] = useReducer(historyReducer, INITIAL_HISTORY);
  const commit = useCallback((scene: AnnotationScene) => dispatch({ type: 'commit', scene }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  return {
    scene: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit,
    undo,
    redo,
    reset,
  };
};
