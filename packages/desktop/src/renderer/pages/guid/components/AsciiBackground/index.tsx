/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { AsciiEngine } from './asciiEngine';
import { pickAsciiStyle, type AsciiStyle } from './asciiStyles';
import { useIdle } from './useIdle';
import styles from './AsciiBackground.module.css';

export const IDLE_DELAY_MS = 20_000;

let lastPickedStyle: AsciiStyle | null = null;

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type AsciiBackgroundProps = {
  /** A new value picks a fresh random style, e.g. on each visit to the page. */
  visitKey: string;
  /** Content the art fades away from so it stays readable. */
  clearRef: React.RefObject<HTMLElement | null>;
};

/** Decorative animated ASCII art that turns colorful while the page is idle. */
const AsciiBackground: React.FC<AsciiBackgroundProps> = ({ visitKey, clearRef }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AsciiEngine | null>(null);
  const reducedMotionRef = useRef(prefersReducedMotion());
  const idle = useIdle(IDLE_DELAY_MS, !reducedMotionRef.current);
  const idleRef = useRef(idle);
  idleRef.current = idle;

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const style = pickAsciiStyle(lastPickedStyle);
    lastPickedStyle = style;
    const engine = AsciiEngine.create({
      canvas,
      root,
      style,
      seed: Math.random() * 1000,
      reducedMotion: reducedMotionRef.current,
    });
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
