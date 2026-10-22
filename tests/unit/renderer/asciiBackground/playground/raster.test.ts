/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  cellChar,
  createFrame,
  forEachGlyph,
  KIND,
  rasterRig,
  rasterShadow,
  RAMP,
} from '@/renderer/pages/guid/components/AsciiBackground/playground/raster';
import { itemRig } from '@/renderer/pages/guid/components/AsciiBackground/playground/rigs';

const place = { left: 10, top: 10, pxPerUnit: 4, dir: 1 as const, fade: 1, kind: KIND.ball };

describe('cellChar', () => {
  it('uses the density ramp when both halves are filled', () => {
    expect(cellChar(1, 1)).toBe(RAMP[RAMP.length - 1]);
    expect(cellChar(0.05, 0.05)).toBe(RAMP[1]);
  });

  it('marks half-filled cells with top or bottom accents and skips empty ones', () => {
    expect(["'", '"']).toContain(cellChar(0.4, 0));
    expect([',', '.']).toContain(cellChar(0, 0.4));
    expect(cellChar(0, 0)).toBe('');
  });
});

describe('rasterRig', () => {
  it('fills sub-pixels with the rig kind and returns its screen box', () => {
    const frame = createFrame(20, 10, 3);
    const rect = rasterRig(frame, itemRig('ball'), place);
    expect(rect).toEqual({ l: 10, t: 10, r: 42, b: 42 });
    expect(frame.kind.includes(KIND.ball)).toBe(true);
  });

  it('ignores rigs that are completely off screen', () => {
    const frame = createFrame(20, 10, 3);
    rasterRig(frame, itemRig('ball'), { ...place, left: -500 });
    expect(frame.value.every((v) => v === 0)).toBe(true);
  });

  it('keeps shadows from covering bodies drawn earlier', () => {
    const frame = createFrame(20, 10, 3);
    rasterRig(frame, itemRig('ball'), place);
    const before = frame.kind.filter((k) => k === KIND.ball).length;
    rasterShadow(frame, 26, 26, 40, 40, 1, 1);
    expect(frame.kind.filter((k) => k === KIND.ball).length).toBe(before);
  });
});

describe('forEachGlyph', () => {
  it('hides glyphs where the clear mask is zero', () => {
    const frame = createFrame(20, 10, 3);
    rasterRig(frame, itemRig('ball'), place);
    let visible = 0;
    forEachGlyph(frame, new Float32Array(0), () => visible++);
    let masked = 0;
    forEachGlyph(frame, new Float32Array(200), () => masked++);
    expect(visible).toBeGreaterThan(0);
    expect(masked).toBe(0);
  });
});
