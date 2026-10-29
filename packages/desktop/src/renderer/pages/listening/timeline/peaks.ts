import { useEffect, useState } from 'react';
import {
  listeningApi,
  targetKey,
  type ListeningError,
  type ListeningTarget,
} from '@/renderer/pages/listening/data/api';

/** Waveform summary of a source recording: int8 min/max per bucket, as served by the host. */
export type Peaks = { bucketMs: number; min: Int8Array; max: Int8Array };

const HEADER_BYTES = 16;

/** Decode the host's `LPK1` peaks format. */
export function parsePeaks(buffer: ArrayBuffer): Peaks {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('AUDIO_PEAKS_INVALID');
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  const count = view.getUint32(8, true);
  if (magic !== 'LPK1' || buffer.byteLength < HEADER_BYTES + count * 2) throw new Error('AUDIO_PEAKS_INVALID');
  const pairs = new Int8Array(buffer, HEADER_BYTES, count * 2);
  const min = new Int8Array(count);
  const max = new Int8Array(count);
  for (let index = 0; index < count; index++) {
    min[index] = pairs[index * 2];
    max[index] = pairs[index * 2 + 1];
  }
  return { bucketMs: view.getUint32(4, true), min, max };
}

/** Parsed peaks per project and source, kept for the page session. */
const cache = new Map<string, Promise<Peaks>>();

/** Peaks for one source recording; the host computes them once and caches them on disk. */
export function usePeaks(
  target: ListeningTarget | undefined,
  source: string | undefined
): { peaks?: Peaks; error?: ListeningError } {
  const [value, setValue] = useState<{ key: string; peaks?: Peaks; error?: ListeningError }>();
  const key = target && source ? `${targetKey(target)}\0${source}` : '';
  useEffect(() => {
    if (!target || !source) return;
    let pending = cache.get(key);
    if (!pending) {
      pending = fetch(listeningApi.peaksUrl(target, source), { credentials: 'include' }).then(async (response) => {
        if (!response.ok) throw new Error('AUDIO_PEAKS_FAILED');
        return parsePeaks(await response.arrayBuffer());
      });
      // A failed request is not cached, so reopening the clip retries.
      pending.catch(() => cache.delete(key));
      cache.set(key, pending);
    }
    let cancelled = false;
    pending.then(
      (peaks) => !cancelled && setValue({ key, peaks }),
      () => !cancelled && setValue({ key, error: { code: 'AUDIO_FAILED', details: [] } })
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies target and source.
  }, [key]);
  return value?.key === key ? { peaks: value.peaks, error: value.error } : {};
}
