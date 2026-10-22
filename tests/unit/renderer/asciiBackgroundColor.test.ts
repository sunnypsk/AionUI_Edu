/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { mixRgb, parseCssColor, samplePalette } from '@/renderer/pages/guid/components/AsciiBackground/asciiColor';

describe('parseCssColor', () => {
  it('parses hex colors in shorthand and longhand', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseCssColor('#165dff')).toEqual({ r: 22, g: 93, b: 255 });
    expect(parseCssColor(' #a1aacb80 ')).toEqual({ r: 161, g: 170, b: 203 });
  });

  it('parses rgb and rgba functional colors, ignoring alpha', () => {
    expect(parseCssColor('rgb(255, 0, 128)')).toEqual({ r: 255, g: 0, b: 128 });
    expect(parseCssColor('rgba(10 20 30 / 0.5)')).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('returns null for input it cannot parse', () => {
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor('not-a-color')).toBeNull();
    expect(parseCssColor('var(--primary)')).toBeNull();
  });
});

describe('mixRgb', () => {
  it('clamps the blend factor to 0..1', () => {
    const a = { r: 0, g: 0, b: 0 };
    const b = { r: 100, g: 200, b: 50 };
    expect(mixRgb(a, b, -1)).toEqual(a);
    expect(mixRgb(a, b, 2)).toEqual(b);
    expect(mixRgb(a, b, 0.5)).toEqual({ r: 50, g: 100, b: 25 });
  });
});

describe('samplePalette', () => {
  const red = { r: 255, g: 0, b: 0 };
  const blue = { r: 0, g: 0, b: 255 };
  const fallback = { r: 9, g: 9, b: 9 };

  it('returns the fallback when the palette is empty', () => {
    expect(samplePalette([], 0.3, fallback)).toBe(fallback);
  });

  it('loops the gradient and wraps out-of-range tones', () => {
    const palette = [red, blue];
    expect(samplePalette(palette, 0, fallback)).toEqual(red);
    expect(samplePalette(palette, 0.5, fallback)).toEqual(blue);
    expect(samplePalette(palette, 1, fallback)).toEqual(red);
    expect(samplePalette(palette, 1.5, fallback)).toEqual(blue);
    expect(samplePalette(palette, -0.5, fallback)).toEqual(blue);
  });
});
