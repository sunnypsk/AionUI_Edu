import React, { useEffect, useRef } from 'react';
import type { Peaks } from '@/renderer/pages/listening/timeline/peaks';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** Draws the `[start, end)` seconds of a source's peaks into a `width` × `height` box, one bar per pixel. */
export function Waveform({
  peaks,
  start,
  end,
  width,
  height,
}: {
  peaks?: Peaks;
  start: number;
  end: number;
  width: number;
  height: number;
}): React.ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (!peaks || end <= start || width <= 0) return;
    context.fillStyle = getComputedStyle(canvas.current!).color;
    const columns = Math.floor(width);
    const secondsPerColumn = (end - start) / columns;
    const bucketsPerSecond = 1000 / peaks.bucketMs;
    const middle = height / 2;
    for (let x = 0; x < columns; x++) {
      const first = Math.floor((start + x * secondsPerColumn) * bucketsPerSecond);
      const last = Math.max(first + 1, Math.ceil((start + (x + 1) * secondsPerColumn) * bucketsPerSecond));
      let low = 0;
      let high = 0;
      for (let bucket = first; bucket < last && bucket < peaks.min.length; bucket++) {
        low = Math.min(low, peaks.min[bucket]);
        high = Math.max(high, peaks.max[bucket]);
      }
      const top = middle - (high / 128) * middle;
      context.fillRect(x, top, 1, Math.max(1, ((high - low) / 128) * middle));
    }
  }, [peaks, start, end, width, height]);
  return <canvas ref={canvas} className={styles.waveform} width={Math.max(1, Math.floor(width))} height={height} />;
}
