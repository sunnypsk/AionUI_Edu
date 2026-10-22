/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Procedural ASCII fields for the new-chat background. Each style writes a
 * brightness (0..1) and a palette tone (0..1) for every character cell.
 */

export const ASCII_STYLES = ['fog', 'ripple', 'stars'] as const;
export type AsciiStyle = (typeof ASCII_STYLES)[number];

/** Center and half-size of the area the ripple style radiates from, in cells. */
export type AsciiFocus = { cx: number; cy: number; hw: number; hh: number };

export type AsciiStar = { x: number; y: number; z: number; tone: number };

export type AsciiField = {
  cols: number;
  rows: number;
  /** Cell height divided by cell width; converts row distances into column units. */
  aspect: number;
  brightness: Float32Array;
  tone: Float32Array;
  focus: AsciiFocus;
  seed: number;
  stars: AsciiStar[] | null;
};

/** Theme color tokens each style blends toward while the page is idle. */
export const STYLE_PALETTE_TOKENS: Record<AsciiStyle, readonly string[]> = {
  fog: ['--success', '--primary', '--brand'],
  ripple: ['--primary', '--brand', '--danger', '--warning'],
  stars: ['--brand', '--primary', '--warning', '--danger'],
};

/** Picks a random style, never repeating the previous one. */
export const pickAsciiStyle = (previous: AsciiStyle | null, random: () => number = Math.random): AsciiStyle => {
  const options = ASCII_STYLES.filter((style) => style !== previous);
  const index = Math.min(options.length - 1, Math.max(0, Math.floor(random() * options.length)));
  return options[index] ?? ASCII_STYLES[0];
};

export const createAsciiField = (cols: number, rows: number, aspect: number, seed: number): AsciiField => ({
  cols,
  rows,
  aspect,
  brightness: new Float32Array(cols * rows),
  tone: new Float32Array(cols * rows),
  focus: { cx: cols / 2, cy: rows / 2, hw: 0, hh: 0 },
  seed,
  stars: null,
});

// --- Noise ------------------------------------------------------------------

const hash3 = (x: number, y: number, z: number): number => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const GRADIENTS = [
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1,
  -1,
];

const grad = (ix: number, iy: number, iz: number, x: number, y: number, z: number): number => {
  const g = Math.floor(hash3(ix, iy, iz) * 12) * 3;
  return GRADIENTS[g] * x + GRADIENTS[g + 1] * y + GRADIENTS[g + 2] * z;
};

const quintic = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const fract = (v: number): number => v - Math.floor(v);

export const smoothstep = (edge0: number, edge1: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Gradient (Perlin-style) noise mapped to roughly 0..1. */
export const noise3 = (x: number, y: number, z: number): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = quintic(xf);
  const v = quintic(yf);
  const w = quintic(zf);
  const n = lerp(
    lerp(
      lerp(grad(xi, yi, zi, xf, yf, zf), grad(xi + 1, yi, zi, xf - 1, yf, zf), u),
      lerp(grad(xi, yi + 1, zi, xf, yf - 1, zf), grad(xi + 1, yi + 1, zi, xf - 1, yf - 1, zf), u),
      v
    ),
    lerp(
      lerp(grad(xi, yi, zi + 1, xf, yf, zf - 1), grad(xi + 1, yi, zi + 1, xf - 1, yf, zf - 1), u),
      lerp(grad(xi, yi + 1, zi + 1, xf, yf - 1, zf - 1), grad(xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1), u),
      v
    ),
    w
  );
  return Math.min(1, Math.max(0, 0.5 + 0.5 * n));
};

export const fbm = (x: number, y: number, z: number, octaves: number): number => {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x, y, z);
    total += amp;
    // Rotate between octaves so lattice edges never line up into visible blocks.
    const nx = 1.6 * x - 1.2 * y;
    y = 1.2 * x + 1.6 * y;
    x = nx + 17.3;
    z = z * 2 + 3.1;
    amp *= 0.5;
  }
  return total > 0 ? sum / total : 0;
};

// --- Styles -----------------------------------------------------------------

const FOG_SCALE = 0.045;

const renderFog = (f: AsciiField, t: number): void => {
  const { cols, rows, aspect, brightness, tone, seed } = f;
  for (let r = 0; r < rows; r++) {
    const y = r * aspect * FOG_SCALE + seed;
    const row = r * cols;
    // Fog is smooth, so even columns are sampled and odd ones interpolated to halve the cost.
    for (let c = 0; c < cols; c += 2) {
      const x = c * FOG_SCALE + seed * 0.7;
      const warp = fbm(x * 0.8 + t * 0.03, y * 0.8, t * 0.05, 2);
      const v = fbm(x + warp * 1.6 - t * 0.05, y + warp * 0.9, t * 0.07, 3);
      brightness[row + c] = Math.pow(smoothstep(0.42, 0.7, v), 1.2);
      tone[row + c] = fract(warp * 1.8 + t * 0.012);
    }
    for (let c = 1; c < cols; c += 2) {
      const right = c + 1 < cols ? c + 1 : c - 1;
      brightness[row + c] = (brightness[row + c - 1] + brightness[row + right]) * 0.5;
      tone[row + c] = tone[row + c - 1];
    }
  }
};

const renderRipple = (f: AsciiField, t: number): void => {
  const { cols, rows, aspect, brightness, tone, focus, seed } = f;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // A shrunken focus box keeps the rings rounded instead of rectangular.
      const dx = Math.max(Math.abs(c - focus.cx) - focus.hw * 0.55, 0);
      const dy = Math.max(Math.abs(r - focus.cy) - focus.hh * 0.3, 0) * aspect;
      const d = Math.sqrt(dx * dx + dy * dy);
      const wobble = noise3(c * 0.06 + seed, r * aspect * 0.06, t * 0.15) * 4;
      const wave = 0.5 + 0.5 * Math.sin(d * 0.32 - t * 1.4 + wobble);
      const i = r * cols + c;
      brightness[i] = Math.pow(wave, 2.2) * (0.25 + 0.75 * Math.exp(-d * 0.018));
      tone[i] = fract(d * 0.012 - t * 0.05 + seed);
    }
  }
};

const spawnStar = (random: () => number, anyDepth: boolean): AsciiStar => ({
  x: random() * 2 - 1,
  y: random() * 2 - 1,
  z: anyDepth ? 0.05 + random() * 0.95 : 1,
  tone: random(),
});

const renderStars = (f: AsciiField, t: number, dt: number, random: () => number): void => {
  const { cols, rows, aspect, brightness, tone } = f;
  brightness.fill(0);
  if (!f.stars) {
    f.stars = Array.from({ length: Math.max(1, Math.round((cols * rows) / 28)) }, () => spawnStar(random, true));
  }
  const cx = cols / 2;
  const cy = rows / 2;
  const scale = Math.max(cols, rows * aspect) * 0.5;
  const plot = (x: number, y: number, b: number, starTone: number): boolean => {
    const c = Math.round(cx + x * scale);
    const r = Math.round(cy + (y * scale) / aspect);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    const i = r * cols + c;
    if (b > brightness[i]) {
      brightness[i] = b;
      tone[i] = starTone;
    }
    return true;
  };
  for (const star of f.stars) {
    star.z -= dt * 0.12;
    if (star.z <= 0.03) Object.assign(star, spawnStar(random, false));
    const b = 0.15 + 0.85 * Math.pow(1 - star.z, 2);
    const onScreen = plot(star.x / star.z, star.y / star.z, b, star.tone);
    for (let k = 1; k <= 4; k++) {
      const tz = star.z + k * 0.03;
      plot(star.x / tz, star.y / tz, b * (1 - k * 0.22), star.tone);
    }
    if (!onScreen) Object.assign(star, spawnStar(random, false));
  }
  // Sparse twinkle so the field never looks empty between stars.
  const tick = Math.floor(t * 2);
  for (let i = 0; i < brightness.length; i += 7) {
    if (brightness[i] < 0.15 && hash3(i, 0, tick + i) > 0.99) {
      brightness[i] = 0.15;
      tone[i] = hash3(i, 1, 0);
    }
  }
};

/** Advances the given style by `dt` seconds and writes the frame into `field`. */
export const renderAsciiField = (
  style: AsciiStyle,
  field: AsciiField,
  t: number,
  dt: number,
  random: () => number = Math.random
): void => {
  if (style === 'fog') renderFog(field, t);
  else if (style === 'ripple') renderRipple(field, t);
  else renderStars(field, t, dt, random);
};
