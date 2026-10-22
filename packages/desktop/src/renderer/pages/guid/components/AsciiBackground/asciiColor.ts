/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type Rgb = { r: number; g: number; b: number };

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_PATTERN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i;

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa` and `rgb()/rgba()` strings; alpha is ignored. */
export const parseCssColor = (value: string): Rgb | null => {
  const input = value.trim();
  const hex = HEX_PATTERN.exec(input);
  if (hex) {
    const digits = hex[1];
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((d) => d + d)
            .join('')
        : digits.slice(0, 6);
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }
  const rgb = RGB_PATTERN.exec(input);
  if (rgb) {
    const channel = (v: string): number => Math.min(255, Math.max(0, Math.round(Number(v))));
    return { r: channel(rgb[1]), g: channel(rgb[2]), b: channel(rgb[3]) };
  }
  return null;
};

export const mixRgb = (from: Rgb, to: Rgb, t: number): Rgb => {
  const k = Math.min(1, Math.max(0, t));
  return {
    r: Math.round(from.r + (to.r - from.r) * k),
    g: Math.round(from.g + (to.g - from.g) * k),
    b: Math.round(from.b + (to.b - from.b) * k),
  };
};

/** Samples a looping gradient through `palette`; `tone` wraps into 0..1. */
export const samplePalette = (palette: readonly Rgb[], tone: number, fallback: Rgb): Rgb => {
  if (palette.length === 0) return fallback;
  const wrapped = tone - Math.floor(tone);
  const scaled = wrapped * palette.length;
  const index = Math.floor(scaled) % palette.length;
  const next = (index + 1) % palette.length;
  return mixRgb(palette[index], palette[next], scaled - Math.floor(scaled));
};

export const rgbToCss = ({ r, g, b }: Rgb): string => `rgb(${r}, ${g}, ${b})`;
