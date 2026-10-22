/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mixRgb, parseCssColor, rgbToCss, samplePalette, type Rgb } from './asciiColor';
import {
  createAsciiField,
  renderAsciiField,
  smoothstep,
  STYLE_PALETTE_TOKENS,
  type AsciiField,
  type AsciiStyle,
} from './asciiStyles';

const CHARSET = ' .:-=+*#%@';
const FONT_SIZE_PX = 12;
const LINE_HEIGHT = 1.2;
const FONT_FAMILY = "'Cascadia Mono', Consolas, Menlo, 'DejaVu Sans Mono', monospace";
const FPS = 14;
const MAX_DPR = 2;
/** Distance over which the art fades in around the greeting and composer. */
const CLEAR_FADE_PX = 90;
const TONE_BUCKETS = 12;
const MONO_TOKEN = '--aou-6';

export const EPIC_RAMP_UP_S = 12;
export const EPIC_RAMP_DOWN_S = 0.8;
const EPIC_SPEED_BOOST = 0.6;
const EPIC_DENSITY_BOOST = 0.35;

/** Moves the idle "epic" level toward its target: slow to build, quick to settle. */
export const stepEpic = (current: number, idle: boolean, dt: number): number =>
  idle ? Math.min(1, current + dt / EPIC_RAMP_UP_S) : Math.max(0, current - dt / EPIC_RAMP_DOWN_S);

export type AsciiEngineOptions = {
  canvas: HTMLCanvasElement;
  /** Element whose size the canvas fills; also receives the `--ascii-epic` variable. */
  root: HTMLElement;
  style: AsciiStyle;
  seed: number;
  reducedMotion: boolean;
};

type ClearRect = { l: number; t: number; r: number; b: number };

export class AsciiEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly root: HTMLElement;
  private readonly style: AsciiStyle;
  private readonly seed: number;
  private readonly reducedMotion: boolean;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly themeObserver: MutationObserver | null;
  private clearElement: HTMLElement | null = null;
  private field: AsciiField | null = null;
  private mask: Float32Array = new Float32Array(0);
  private cellW = 0;
  private cellH = 0;
  private mono: Rgb = { r: 128, g: 128, b: 128 };
  private palette: Rgb[] = [];
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private time = 0;
  private epic = 0;
  private idle = false;

  private constructor(options: AsciiEngineOptions, ctx: CanvasRenderingContext2D) {
    this.canvas = options.canvas;
    this.ctx = ctx;
    this.root = options.root;
    this.style = options.style;
    this.seed = options.seed;
    this.reducedMotion = options.reducedMotion;
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(this.root);
    this.themeObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            this.refreshColors();
            this.drawFrame(0);
          })
        : null;
    this.themeObserver?.observe(document.documentElement, { attributes: true });
    this.themeObserver?.observe(document.head, { childList: true });
  }

  /** Returns null when the browser cannot provide a 2D canvas context. */
  static create(options: AsciiEngineOptions): AsciiEngine | null {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = options.canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    return ctx ? new AsciiEngine(options, ctx) : null;
  }

  setClearElement(element: HTMLElement | null): void {
    if (this.clearElement) this.resizeObserver?.unobserve(this.clearElement);
    this.clearElement = element;
    if (element) this.resizeObserver?.observe(element);
    this.computeMask();
  }

  setIdle(idle: boolean): void {
    this.idle = idle && !this.reducedMotion;
  }

  start(): void {
    this.refreshColors();
    this.resize();
    if (this.reducedMotion || this.raf) return;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
  }

  private readonly tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    const elapsed = Math.min(Math.max(now - this.lastFrame, 0), 250);
    this.lastFrame = now;
    if (document.hidden) return;
    this.acc += elapsed;
    if (this.acc < 1000 / FPS) return;
    const dt = this.acc / 1000;
    this.acc = 0;
    this.epic = stepEpic(this.epic, this.idle, dt);
    const scaledDt = dt * (1 + EPIC_SPEED_BOOST * smoothstep(0, 1, this.epic));
    this.time += scaledDt;
    this.drawFrame(scaledDt);
  };

  private resize(): void {
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    // Resizing the canvas resets its 2D state, so font and transform are reapplied.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.font = `${FONT_SIZE_PX}px ${FONT_FAMILY}`;
    this.ctx.textBaseline = 'top';
    this.cellW = this.ctx.measureText('M').width || FONT_SIZE_PX * 0.6;
    this.cellH = Math.round(FONT_SIZE_PX * LINE_HEIGHT);
    const cols = Math.ceil(width / this.cellW);
    const rows = Math.ceil(height / this.cellH);
    this.field = createAsciiField(cols, rows, this.cellH / this.cellW, this.seed);
    this.computeMask();
    this.drawFrame(0);
  }

  private computeMask(): void {
    const field = this.field;
    if (!field) return;
    const { cols, rows } = field;
    const base = this.canvas.getBoundingClientRect();
    let rect: ClearRect | null = null;
    if (this.clearElement) {
      const r = this.clearElement.getBoundingClientRect();
      rect = { l: r.left - base.left, t: r.top - base.top, r: r.right - base.left, b: r.bottom - base.top };
      field.focus = {
        cx: (rect.l + rect.r) / 2 / this.cellW,
        cy: (rect.t + rect.b) / 2 / this.cellH,
        hw: (rect.r - rect.l) / 2 / this.cellW,
        hh: (rect.b - rect.t) / 2 / this.cellH,
      };
    }
    this.mask = new Float32Array(cols * rows);
    for (let row = 0; row < rows; row++) {
      const py = (row + 0.5) * this.cellH;
      for (let col = 0; col < cols; col++) {
        let value = 1;
        if (rect) {
          const px = (col + 0.5) * this.cellW;
          const dx = Math.max(rect.l - px, 0, px - rect.r);
          const dy = Math.max(rect.t - py, 0, py - rect.b);
          value = smoothstep(0, CLEAR_FADE_PX, Math.hypot(dx, dy));
        }
        this.mask[row * cols + col] = value;
      }
    }
  }

  private readColor(styles: CSSStyleDeclaration, token: string): Rgb | null {
    const raw = styles.getPropertyValue(token).trim();
    if (!raw) return null;
    // Routing through fillStyle normalizes any CSS color syntax into hex or rgba().
    this.ctx.fillStyle = '#000000';
    this.ctx.fillStyle = raw;
    return parseCssColor(String(this.ctx.fillStyle));
  }

  private refreshColors(): void {
    const styles = getComputedStyle(this.canvas);
    this.mono = this.readColor(styles, MONO_TOKEN) ?? parseCssColor(styles.color) ?? this.mono;
    this.palette = STYLE_PALETTE_TOKENS[this.style]
      .map((token) => this.readColor(styles, token))
      .filter((color): color is Rgb => color !== null);
  }

  private drawFrame(dt: number): void {
    const field = this.field;
    if (!field) return;
    renderAsciiField(this.style, field, this.time, dt);
    const epic = smoothstep(0, 1, this.epic);
    this.root.style.setProperty('--ascii-epic', epic.toFixed(3));

    const buckets = epic < 0.005 ? 1 : TONE_BUCKETS;
    const fills: string[] = [];
    for (let k = 0; k < buckets; k++) {
      const target = samplePalette(this.palette, (k + 0.5) / buckets, this.mono);
      fills.push(rgbToCss(mixRgb(this.mono, target, epic)));
    }

    const { ctx, cellW, cellH, mask } = this;
    const { cols, rows, brightness, tone } = field;
    const levels = CHARSET.length;
    const exponent = 1 - EPIC_DENSITY_BOOST * epic;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let activeFill = '';
    for (let row = 0; row < rows; row++) {
      const y = row * cellH;
      let run = '';
      let runStart = 0;
      let runBucket = -1;
      const flush = (): void => {
        if (!run) return;
        const fill = fills[runBucket] ?? fills[0];
        if (fill !== activeFill) {
          ctx.fillStyle = fill;
          activeFill = fill;
        }
        ctx.fillText(run, runStart * cellW, y);
        run = '';
      };
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const level = Math.pow(brightness[i] * mask[i], exponent);
        const char = CHARSET[Math.min(levels - 1, Math.floor(level * levels))];
        if (char === ' ') {
          flush();
          continue;
        }
        const bucket = buckets === 1 ? 0 : Math.min(buckets - 1, Math.floor(tone[i] * buckets));
        if (!run || bucket !== runBucket) {
          flush();
          runStart = col;
          runBucket = bucket;
        }
        run += char;
      }
      flush();
    }
  }
}
