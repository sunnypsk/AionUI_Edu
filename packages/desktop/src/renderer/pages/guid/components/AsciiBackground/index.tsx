/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { AsciiEngine } from './asciiEngine';
import { pickBackgroundScene, type BackgroundScene } from './asciiStyles';
import { PlaygroundEngine } from './playground/playgroundEngine';
import { useIdle } from './useIdle';
import styles from './AsciiBackground.module.css';

export const IDLE_DELAY_MS = 20_000;

let lastPickedScene: BackgroundScene | null = null;

type BackgroundEngine = Pick<AsciiEngine, 'setClearElement' | 'setIdle' | 'start' | 'destroy'>;

const createEngine = (
  scene: BackgroundScene,
  canvas: HTMLCanvasElement,
  root: HTMLElement,
  reducedMotion: boolean
): BackgroundEngine | null =>
  scene === 'playground'
    ? PlaygroundEngine.create({ canvas, root, reducedMotion })
    : AsciiEngine.create({ canvas, root, style: scene, seed: Math.random() * 1000, reducedMotion });

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type AsciiBackgroundProps = {
  /** A new value picks a fresh random style, e.g. on each visit to the page. */
  visitKey: string;
  /** Content the art fades away from so it stays readable. */
  clearRef: React.RefObject<HTMLElement | null>;
};

/** Decorative animated ASCII art that turns colorful while the page is idle; one scene is an interactive pet playground. */
const AsciiBackground: React.FC<AsciiBackgroundProps> = ({ visitKey, clearRef }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BackgroundEngine | null>(null);
  const reducedMotionRef = useRef(prefersReducedMotion());
  const idle = useIdle(IDLE_DELAY_MS, !reducedMotionRef.current);
  const idleRef = useRef(idle);
  idleRef.current = idle;

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const scene = pickBackgroundScene(lastPickedScene);
    lastPickedScene = scene;
    root.dataset.scene = scene;
    const engine = createEngine(scene, canvas, root, reducedMotionRef.current);
    if (!engine) return;
    engine.setClearElement(clearRef.current);
    engine.setIdle(idleRef.current);
    engine.start();
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [visitKey, clearRef]);

  useEffect(() => {
    engineRef.current?.setIdle(idle);
  }, [idle]);

  return (
    <div ref={rootRef} className={styles.root} aria-hidden='true' data-testid='ascii-background'>
      <div className={styles.aura} />
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
};

export default AsciiBackground;
