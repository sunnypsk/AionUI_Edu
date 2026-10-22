/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  clampToFloor,
  createStage,
  D_FAR,
  D_NEAR,
  depthFade,
  projectGround,
  unprojectGround,
} from '@/renderer/pages/guid/components/AsciiBackground/playground/stage';

describe('playground stage', () => {
  const stage = createStage(1440, 900);

  it('maps a floor point to the screen and back', () => {
    const screen = projectGround(stage, 120, 1.7);
    const back = unprojectGround(stage, screen.sx, screen.sy);
    expect(back?.x).toBeCloseTo(120);
    expect(back?.d).toBeCloseTo(1.7);
  });

  it('draws far things higher and smaller than near things', () => {
    const near = projectGround(stage, 0, D_NEAR);
    const far = projectGround(stage, 0, D_FAR);
    expect(far.sy).toBeLessThan(near.sy);
    expect(far.pxPerUnit).toBeLessThan(near.pxPerUnit);
  });

  it('returns null above the far edge of the floor', () => {
    expect(unprojectGround(stage, 700, stage.horizon + 1)).toBeNull();
  });

  it('lets the floor widen with depth and clamps depth into range', () => {
    expect(clampToFloor({ x: 1e6, d: D_FAR }, 100).x).toBeCloseTo(100 * D_FAR);
    expect(clampToFloor({ x: -1e6, d: 0.2 }, 100)).toEqual({ x: -100, d: D_NEAR });
  });

  it('fades with depth', () => {
    expect(depthFade(D_NEAR)).toBe(1);
    expect(depthFade(D_FAR)).toBeLessThan(depthFade(1.5));
  });
});
