/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ASCII_STYLES,
  createAsciiField,
  pickAsciiStyle,
  renderAsciiField,
  STYLE_PALETTE_TOKENS,
} from '@/renderer/pages/guid/components/AsciiBackground/asciiStyles';

describe('pickAsciiStyle', () => {
  it('picks every style eventually when starting fresh', () => {
    const picked = new Set<string>();
    for (let i = 0; i < 200; i++) picked.add(pickAsciiStyle(null));
    expect(picked).toEqual(new Set(ASCII_STYLES));
  });

  it('never repeats the previous style', () => {
    let previous: string | null = null;
    for (let i = 0; i < 200; i++) {
      const next = pickAsciiStyle(previous as (typeof ASCII_STYLES)[number] | null);
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  it('handles out-of-range random values without crashing', () => {
    expect(ASCII_STYLES).toContain(pickAsciiStyle(null, () => 0));
    expect(ASCII_STYLES).toContain(pickAsciiStyle(null, () => 0.999999));
  });
});

describe('renderAsciiField', () => {
  const makeField = () => createAsciiField(16, 8, 2, 7);

  it.each(ASCII_STYLES)('%s writes brightness and tone within 0..1', (style) => {
    const field = makeField();
    renderAsciiField(style, field, 3, 1 / 14, () => 0.42);
    for (const v of field.brightness) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (const v of field.tone) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('every style maps to a non-empty theme-token palette', () => {
    for (const style of ASCII_STYLES) {
      const tokens = STYLE_PALETTE_TOKENS[style];
      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) expect(token).toMatch(/^--/);
    }
  });

  it('fog leaves the field visibly non-empty', () => {
    const field = makeField();
    renderAsciiField('fog', field, 5, 0, () => 0.5);
    const total = field.brightness.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('stars respawn without leaking NaN when time advances in big steps', () => {
    const field = makeField();
    const random = vi.fn(() => 0.5);
    renderAsciiField('stars', field, 0, 0, random);
    renderAsciiField('stars', field, 10, 10, random);
    for (const v of field.brightness) expect(Number.isFinite(v)).toBe(true);
  });
});
