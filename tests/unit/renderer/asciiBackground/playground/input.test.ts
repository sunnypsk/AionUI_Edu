/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  cursorFor,
  hitTest,
  isBackgroundTarget,
  pushSample,
  screenSpeed,
  throwVelocity,
} from '@/renderer/pages/guid/components/AsciiBackground/playground/input';
import type { HitBox } from '@/renderer/pages/guid/components/AsciiBackground/playground/scene';

const box = (id: string, type: 'pet' | 'item', l: number): HitBox =>
  type === 'pet'
    ? { type, id, kind: 'cat', rect: { l, t: 0, r: l + 50, b: 50 } }
    : { type, id, kind: 'ball', rect: { l, t: 0, r: l + 10, b: 10 } };

describe('isBackgroundTarget', () => {
  it('accepts only the background surfaces themselves', () => {
    const surface = {} as EventTarget;
    const button = {} as EventTarget;
    expect(isBackgroundTarget(surface, [surface, null])).toBe(true);
    expect(isBackgroundTarget(button, [surface])).toBe(false);
    expect(isBackgroundTarget(null, [null])).toBe(false);
  });
});

describe('hitTest', () => {
  it('returns the front-most box under the point', () => {
    const boxes = [box('back', 'pet', 0), box('front', 'pet', 20)];
    expect(hitTest(boxes, 30, 10)?.id).toBe('front');
    expect(hitTest(boxes, 5, 10)?.id).toBe('back');
  });

  it('gives small items a forgiving margin and misses empty space', () => {
    const boxes = [box('ball', 'item', 100)];
    expect(hitTest(boxes, 114, 5)?.id).toBe('ball');
    expect(hitTest(boxes, 300, 5)).toBeNull();
  });
});

describe('cursorFor', () => {
  it('hints what a click will do', () => {
    expect(cursorFor(box('ball', 'item', 0), false)).toBe('grab');
    expect(cursorFor(box('cat', 'pet', 0), false)).toBe('pointer');
    expect(cursorFor(null, true)).toBe('grabbing');
  });
});

describe('pointer samples', () => {
  it('forgets samples older than the velocity window', () => {
    let samples = pushSample([], { t: 0, sx: 0, sy: 0, ground: null });
    samples = pushSample(samples, { t: 500, sx: 10, sy: 0, ground: null });
    expect(samples).toHaveLength(1);
  });

  it('measures screen speed and stays at zero for a single sample', () => {
    const samples = [
      { t: 0, sx: 0, sy: 0, ground: null },
      { t: 50, sx: 30, sy: 40, ground: null },
    ];
    expect(screenSpeed(samples)).toBeCloseTo(1000);
    expect(screenSpeed(samples.slice(0, 1))).toBe(0);
  });

  it('turns a fast drag into a throw with an upward arc', () => {
    const v = throwVelocity(
      [
        { t: 0, sx: 0, sy: 0, ground: { x: 0, d: 1.5 } },
        { t: 50, sx: 0, sy: 0, ground: { x: 30, d: 1.5 } },
      ],
      380
    );
    expect(v.vx).toBeCloseTo(600);
    expect(v.vz).toBeGreaterThan(0);
  });

  it('does not throw when the drag never touched the floor', () => {
    expect(throwVelocity([{ t: 0, sx: 0, sy: 0, ground: null }], 380)).toEqual({ vx: 0, vd: 0, vz: 0 });
  });
});
