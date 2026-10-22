/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mixRgb, parseCssColor, type Rgb } from '../asciiColor';
import { stepEpic } from '../asciiEngine';
import { smoothstep } from '../asciiStyles';
import {
  cursorFor,
  hitTest,
  isBackgroundTarget,
  pushSample,
  screenSpeed,
  throwVelocity,
  type PointerSample,
} from './input';
import { createFrame, forEachGlyph, KIND, KIND_COUNT, type Frame } from './raster';
import { renderScene, type EmoteGlyph, type SceneOutput } from './scene';
import { createStage, DEPTH_TO_X, projectGround, RIG_TO_WORLD, unprojectGround, type Stage } from './stage';
import { loadWorld, saveWorld } from './storage';
import type { EmoteKind, GroundPoint, World } from './types';
import {
  createWorld,
  dragToy,
  dropFood,
  grabToy,
  petPet,
  pickUpPoo,
  stepWorld,
  throwToy,
  type WorldEnv,
} from './world';

const FONT_SIZE_PX = 6;
const FONT_FAMILY = "'Cascadia Mono', Consolas, Menlo, 'DejaVu Sans Mono', monospace";
const FPS = 20;
const MAX_DPR = 2;
/** Distance over which the playground fades in around the greeting and composer. */
const CLEAR_FADE_PX = 60;
const MONO_TOKEN = '--aou-6';
const SAVE_INTERVAL_S = 10;
/** Pets keep a hint of their color even while the page is in use. */
const BASE_TINT = 0.2;
const FADE_BUCKETS = 6;
const POINTER_SPEED_DECAY = 6;
/** Keeps whole pets on screen at the side edges. */
const PET_EDGE_MARGIN = 26 * RIG_TO_WORLD;
/** Rough pet footprint in rig units, used to keep pets out from behind the page content. */
const PET_HALF_W = 24;
const PET_H = 30;
/** Includes most of the clear fade, so pets never stand half-faded at the content edge. */
const BLOCK_MARGIN_PX = 16 + CLEAR_FADE_PX * 0.75;

const KIND_TOKENS: Record<number, string> = {
  [KIND.cat]: '--warning',
  [KIND.dog]: '--warning',
  [KIND.food]: '--success',
  [KIND.poo]: '--warning',
  [KIND.ball]: '--danger',
  [KIND.bone]: '--primary',
};

/** How far a kind's accent is muted toward the neutral tone: the dog reads tan, poo muddy. */
const KIND_MUTE: Record<number, number> = { [KIND.dog]: 0.45, [KIND.poo]: 0.6 };

const EMOTE_TOKENS: Record<EmoteKind, string> = {
  love: '--danger',
  sleep: '--primary',
  alert: '--warning',
  hungry: '--success',
  sparkle: '--warning',
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type PlaygroundEngineOptions = {
  canvas: HTMLCanvasElement;
  /** Element whose size the canvas fills; its parent is the clickable page background. */
  root: HTMLElement;
  reducedMotion: boolean;
  storage?: StorageLike | null;
  random?: () => number;
};

type ClearRect = { l: number; t: number; r: number; b: number };
type Drag = { itemId: string; samples: PointerSample[] };

const defaultStorage = (): StorageLike | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const rgba = ({ r, g, b }: Rgb, a: number): string => `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;

/** Interactive cat-and-dog playground drawn as dense ASCII on a perspective floor. */
export class PlaygroundEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly root: HTMLElement;
  private readonly surface: HTMLElement | null;
  private readonly reducedMotion: boolean;
  private readonly storage: StorageLike | null;
  private readonly env: WorldEnv;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly themeObserver: MutationObserver | null;
  private readonly surfaceCursor: string;
  private clearElement: HTMLElement | null = null;
  private clearRect: ClearRect | null = null;
  private world: World | null = null;
  private stage: Stage | null = null;
  private frame: Frame | null = null;
  private scene: SceneOutput = { boxes: [], emotes: [] };
  private mask: Float32Array = new Float32Array(0);
  private cellW = 0;
  private cellH = 0;
  private mono: Rgb = { r: 128, g: 128, b: 128 };
  private kindColors: (Rgb | null)[] = [];
  private emoteColors: Partial<Record<EmoteKind, Rgb>> = {};
  private fills: string[] = [];
  private fillsEpic = -1;
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private epic = 0;
  private idle = false;
  private saveTimer = SAVE_INTERVAL_S;
  private samples: PointerSample[] = [];
  private pointerSpeed = 0;
  private drag: Drag | null = null;
  private listening = false;

  private constructor(options: PlaygroundEngineOptions, ctx: CanvasRenderingContext2D) {
    this.canvas = options.canvas;
    this.ctx = ctx;
    this.root = options.root;
    this.surface = options.root.parentElement;
    this.surfaceCursor = this.surface?.style.cursor ?? '';
    this.reducedMotion = options.reducedMotion;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.env = { random: options.random ?? Math.random, isBlocked: (p) => this.isBlocked(p) };
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(this.root);
    this.themeObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            this.refreshColors();
            this.draw();
          })
        : null;
    this.themeObserver?.observe(document.documentElement, { attributes: true });
    this.themeObserver?.observe(document.head, { childList: true });
  }

  /** Returns null when the browser cannot provide a 2D canvas context. */
  static create(options: PlaygroundEngineOptions): PlaygroundEngine | null {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = options.canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    return ctx ? new PlaygroundEngine(options, ctx) : null;
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
    this.listen(true);
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.listen(false);
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    if (this.surface) this.surface.style.cursor = this.surfaceCursor;
    this.save();
  }

  private listen(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('pointermove', this.onPointerMove);
    window[method]('pointerdown', this.onPointerDown);
    window[method]('pointerup', this.onPointerUp);
    window[method]('pointercancel', this.onPointerUp);
    window[method]('blur', this.onPointerUp);
    window[method]('pagehide', this.onPageHide);
    document[method]('visibilitychange', this.onPageHide);
  }

  private save(): void {
    if (this.world && !this.reducedMotion) saveWorld(this.storage, this.world, Date.now());
    this.saveTimer = SAVE_INTERVAL_S;
  }

  private readonly onPageHide = (): void => this.save();

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
    this.pointerSpeed *= Math.exp(-POINTER_SPEED_DECAY * dt);
    const world = this.world;
    if (!world) return;
    if (world.pointer) world.pointer.speed = this.pointerSpeed;
    stepWorld(world, dt, this.env);
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) this.save();
    this.draw();
  };

  // --- Layout ---------------------------------------------------------------------

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
    // Two square sub-pixels stack in every cell.
    this.cellH = this.cellW * 2;
    this.frame = createFrame(Math.ceil(width / this.cellW), Math.ceil(height / this.cellH), this.cellW);
    this.stage = createStage(width, height);
    const xLimit = Math.max(60, this.stage.xLimit - PET_EDGE_MARGIN);
    this.computeMask();
    if (this.world) {
      this.world.xLimit = xLimit;
    } else {
      this.world = loadWorld(this.storage, xLimit, this.env, Date.now()) ?? createWorld(xLimit, this.env);
      if (this.reducedMotion) {
        for (const pet of this.world.pets) pet.activity = 'sleep';
      }
    }
    this.draw();
  }

  private computeMask(): void {
    const frame = this.frame;
    if (!frame) return;
    const { cols, rows } = frame;
    const base = this.canvas.getBoundingClientRect();
    let rect: ClearRect | null = null;
    if (this.clearElement) {
      const r = this.clearElement.getBoundingClientRect();
      rect = { l: r.left - base.left, t: r.top - base.top, r: r.right - base.left, b: r.bottom - base.top };
    }
    this.clearRect = rect;
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

  private isBlocked(p: GroundPoint): boolean {
    const rect = this.clearRect;
    const stage = this.stage;
    if (!rect || !stage) return false;
    const g = projectGround(stage, p.x, p.d);
    const pxr = g.pxPerUnit * RIG_TO_WORLD;
    const m = BLOCK_MARGIN_PX;
    return (
      g.sx + PET_HALF_W * pxr > rect.l - m &&
      g.sx - PET_HALF_W * pxr < rect.r + m &&
      g.sy > rect.t - m &&
      g.sy - PET_H * pxr < rect.b + m
    );
  }

  // --- Pointer --------------------------------------------------------------------

  private localPoint(event: PointerEvent): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const x = event.clientX - r.left;
    const y = event.clientY - r.top;
    return x >= 0 && y >= 0 && x <= r.width && y <= r.height ? { x, y } : null;
  }

  private onBackground(event: PointerEvent): boolean {
    return isBackgroundTarget(event.target, [this.surface, this.root, this.canvas]);
  }

  private setCursor(cursor: string): void {
    if (this.surface && this.surface.style.cursor !== (cursor || this.surfaceCursor)) {
      this.surface.style.cursor = cursor || this.surfaceCursor;
    }
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const world = this.world;
    const stage = this.stage;
    if (!world || !stage) return;
    const local = this.localPoint(event);
    const ground = local ? unprojectGround(stage, local.x, local.y) : null;
    const sample: PointerSample = { t: event.timeStamp, sx: event.clientX, sy: event.clientY, ground };
    this.samples = pushSample(this.samples, sample);
    this.pointerSpeed = Math.max(this.pointerSpeed * 0.5, screenSpeed(this.samples));
    if (this.drag) {
      this.drag.samples = pushSample(this.drag.samples, sample);
      if (ground) dragToy(world, this.drag.itemId, ground, 0);
      this.setCursor(cursorFor(null, true));
      return;
    }
    if (!local || !this.onBackground(event)) {
      world.pointer = null;
      this.setCursor('');
      return;
    }
    const hit = hitTest(this.scene.boxes, local.x, local.y);
    world.pointer = { ground, overPetId: hit?.type === 'pet' ? hit.id : null, speed: this.pointerSpeed };
    this.setCursor(cursorFor(hit, false));
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const world = this.world;
    const stage = this.stage;
    if (!world || !stage || event.button !== 0 || !this.onBackground(event)) return;
    const local = this.localPoint(event);
    if (!local) return;
    const hit = hitTest(this.scene.boxes, local.x, local.y);
    const ground = unprojectGround(stage, local.x, local.y);
    if (hit?.type === 'item' && (hit.kind === 'ball' || hit.kind === 'bone')) {
      if (!grabToy(world, hit.id)) return;
      event.preventDefault();
      const sample: PointerSample = { t: event.timeStamp, sx: event.clientX, sy: event.clientY, ground };
      this.drag = { itemId: hit.id, samples: [sample] };
      this.setCursor(cursorFor(null, true));
    } else if (hit?.type === 'item' && hit.kind === 'poo') {
      pickUpPoo(world, hit.id);
    } else if (hit?.type === 'pet') {
      petPet(world, hit.id);
    } else if (ground) {
      dropFood(world, ground);
    } else {
      return;
    }
    this.draw();
  };

  private readonly onPointerUp = (): void => {
    const drag = this.drag;
    if (!drag || !this.world) return;
    this.drag = null;
    throwToy(this.world, drag.itemId, throwVelocity(drag.samples, DEPTH_TO_X), this.env.random);
    this.setCursor('');
  };

  // --- Painting -------------------------------------------------------------------

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
    this.kindColors = Array.from({ length: KIND_COUNT }, (_, kind) => {
      const token = KIND_TOKENS[kind];
      const color = token ? this.readColor(styles, token) : null;
      return color ? mixRgb(color, this.mono, KIND_MUTE[kind] ?? 0) : null;
    });
    this.emoteColors = {};
    for (const kind of Object.keys(EMOTE_TOKENS) as EmoteKind[]) {
      this.emoteColors[kind] = this.readColor(styles, EMOTE_TOKENS[kind]) ?? this.mono;
    }
    this.fillsEpic = -1;
  }

  /** One fill per sub-pixel kind and depth-fade bucket, rebuilt only when the idle tint moves. */
  private refreshFills(epic: number): void {
    const level = Math.round(epic * 50) / 50;
    if (level === this.fillsEpic) return;
    this.fillsEpic = level;
    this.fills = [];
    for (let kind = 0; kind < KIND_COUNT; kind++) {
      const target = this.kindColors[kind];
      const color = target ? mixRgb(this.mono, target, BASE_TINT + (1 - BASE_TINT) * level) : this.mono;
      for (let bucket = 0; bucket < FADE_BUCKETS; bucket++) {
        const fade = bucket / (FADE_BUCKETS - 1);
        this.fills.push(rgba(color, 0.45 + 0.55 * fade));
      }
    }
  }

  private draw(): void {
    const { frame, stage, world, ctx } = this;
    if (!frame || !stage || !world) return;
    this.scene = renderScene(frame, stage, world);
    const epic = smoothstep(0, 1, this.epic);
    this.root.style.setProperty('--ascii-epic', epic.toFixed(3));
    this.refreshFills(epic);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const { cellW, cellH, fills } = this;
    let activeFill = '';
    let run = '';
    let runCol = 0;
    let runRow = -1;
    let runFill = '';
    const flush = (): void => {
      if (!run) return;
      if (runFill !== activeFill) {
        ctx.fillStyle = runFill;
        activeFill = runFill;
      }
      ctx.fillText(run, runCol * cellW, runRow * cellH);
      run = '';
    };
    forEachGlyph(frame, this.mask, (col, row, ch, kind, fade) => {
      const bucket = Math.min(FADE_BUCKETS - 1, Math.max(0, Math.round(fade * (FADE_BUCKETS - 1))));
      const fill = fills[kind * FADE_BUCKETS + bucket] ?? fills[0];
      if (run && row === runRow && col === runCol + run.length && fill === runFill) {
        run += ch;
        return;
      }
      flush();
      run = ch;
      runCol = col;
      runRow = row;
      runFill = fill;
    });
    flush();
    this.drawEmotes(this.scene.emotes);
  }

  private maskAt(x: number, y: number): number {
    const frame = this.frame;
    if (!frame || this.mask.length !== frame.cols * frame.rows) return 1;
    const col = Math.floor(x / this.cellW);
    const row = Math.floor(y / this.cellH);
    if (col < 0 || row < 0 || col >= frame.cols || row >= frame.rows) return 0;
    return this.mask[row * frame.cols + col];
  }

  private drawEmotes(emotes: readonly EmoteGlyph[]): void {
    if (emotes.length === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const emote of emotes) {
      const alpha = emote.alpha * this.maskAt(emote.x, emote.y);
      if (alpha < 0.03) continue;
      ctx.font = `bold ${emote.size}px ${FONT_FAMILY}`;
      ctx.fillStyle = rgba(this.emoteColors[emote.kind] ?? this.mono, alpha);
      ctx.fillText(emote.text, emote.x, emote.y);
    }
    ctx.restore();
  }
}
