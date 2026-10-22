/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeCrop,
  rectFromPoints,
  strokeWidthFor,
} from '@/renderer/pages/conversation/Messages/acp/ImageAnnotator/drawAnnotations';
import { splitFileName } from '@/renderer/pages/conversation/Messages/acp/ImageAnnotator/attachImageEdit';
import {
  historyReducer,
  INITIAL_HISTORY,
} from '@/renderer/pages/conversation/Messages/acp/ImageAnnotator/useAnnotationHistory';
import type { AnnotationScene } from '@/renderer/pages/conversation/Messages/acp/ImageAnnotator/types';

const sceneWith = (count: number): AnnotationScene => ({
  annotations: Array.from({ length: count }, (_, index) => ({
    kind: 'rect' as const,
    color: '#F53F3F',
    width: 4,
    from: { x: index, y: index },
    to: { x: index + 10, y: index + 10 },
  })),
  crop: null,
});

describe('annotation history', () => {
  it('restores the previous scene on undo and re-applies it on redo', () => {
    const one = historyReducer(INITIAL_HISTORY, { type: 'commit', scene: sceneWith(1) });
    const two = historyReducer(one, { type: 'commit', scene: sceneWith(2) });
    const undone = historyReducer(two, { type: 'undo' });
    expect(undone.present).toBe(one.present);
    expect(historyReducer(undone, { type: 'redo' }).present).toBe(two.present);
  });

  it('discards the redo branch when a new edit is committed after undo', () => {
    const one = historyReducer(INITIAL_HISTORY, { type: 'commit', scene: sceneWith(1) });
    const undone = historyReducer(one, { type: 'undo' });
    const branched = historyReducer(undone, { type: 'commit', scene: sceneWith(3) });
    expect(branched.future).toEqual([]);
  });

  it('ignores undo and redo when there is nothing to step to', () => {
    expect(historyReducer(INITIAL_HISTORY, { type: 'undo' })).toBe(INITIAL_HISTORY);
    expect(historyReducer(INITIAL_HISTORY, { type: 'redo' })).toBe(INITIAL_HISTORY);
  });

  it('returns to an empty scene on reset', () => {
    const one = historyReducer(INITIAL_HISTORY, { type: 'commit', scene: sceneWith(1) });
    expect(historyReducer(one, { type: 'reset' })).toBe(INITIAL_HISTORY);
  });
});

describe('crop geometry', () => {
  it('normalizes a crop dragged from bottom-right to top-left', () => {
    expect(normalizeCrop({ x: 80, y: 60 }, { x: 20, y: 10 }, 100, 100)).toEqual({
      x: 20,
      y: 10,
      width: 60,
      height: 50,
    });
  });

  it('clamps a crop dragged outside the image to the image bounds', () => {
    expect(normalizeCrop({ x: -30, y: -5 }, { x: 140, y: 50 }, 100, 80)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  });

  it('treats a tiny drag as an accidental click and clears the crop', () => {
    expect(normalizeCrop({ x: 10, y: 10 }, { x: 13, y: 40 }, 100, 100)).toBeNull();
  });

  it('builds a positive-size rectangle regardless of drag direction', () => {
    expect(rectFromPoints({ x: 5, y: 9 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2, width: 4, height: 7 });
  });
});

describe('stroke sizing', () => {
  it('scales stroke width with the longer side of the image', () => {
    expect(strokeWidthFor('large', 1000, 2000)).toBe(32);
  });

  it('never returns a stroke thinner than two pixels on tiny images', () => {
    expect(strokeWidthFor('small', 40, 30)).toBe(2);
  });
});

describe('splitFileName', () => {
  it('separates the base name from the last extension', () => {
    expect(splitFileName('ig_scene.v2.png')).toEqual({ base: 'ig_scene.v2', ext: '.png' });
  });

  it('keeps dotfiles and extensionless names whole', () => {
    expect(splitFileName('.hidden')).toEqual({ base: '.hidden', ext: '' });
    expect(splitFileName('image')).toEqual({ base: 'image', ext: '' });
  });

  it('falls back to a default base for an empty name', () => {
    expect(splitFileName('')).toEqual({ base: 'image', ext: '' });
  });
});
