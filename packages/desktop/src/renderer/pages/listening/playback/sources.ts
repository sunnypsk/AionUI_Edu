import { joinPath } from '@/common/chat/chatLib';
import { localFileRef } from '@/common/types/chatFile';
import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';
import { listeningApi, type ListeningTarget } from '@/renderer/pages/listening/data/api';
import type { AudioSources, PlayableEntry } from '@/renderer/pages/listening/playback/scheduler';

export const DECODED_CACHE_BYTES = 64 * 1024 * 1024;
/** Host-side segment cache directory, mirrored from the web host's SEGMENT_CACHE. */
const SEGMENT_CACHE = 'listening/.segments';

/** Fetch and decode preview audio: cached speech lines whole, recordings in short host-decoded ranges. */
export function createSources(context: BaseAudioContext, target: ListeningTarget, workspace: string): AudioSources {
  // Insertion-ordered map as an LRU: re-inserting on hit moves an entry to the end.
  const decoded = new Map<string, { buffer: AudioBuffer; bytes: number }>();
  const pending = new Map<string, { signal: AbortSignal; promise: Promise<AudioBuffer> }>();
  let total = 0;
  const remember = (key: string, buffer: AudioBuffer) => {
    const bytes = buffer.length * buffer.numberOfChannels * 4;
    if (bytes > DECODED_CACHE_BYTES) return;
    decoded.set(key, { buffer, bytes });
    total += bytes;
    for (const [oldest, value] of decoded) {
      if (total <= DECODED_CACHE_BYTES || oldest === key) break;
      decoded.delete(oldest);
      total -= value.bytes;
    }
  };
  return {
    async load(entry: PlayableEntry, from: number, to: number, signal: AbortSignal): Promise<AudioBuffer> {
      signal.throwIfAborted();
      const source = entry.source;
      let url: string;
      let key: string;
      if (source.kind === 'speech') {
        key = `speech:${source.key}`;
        url = buildFileStreamUrl(localFileRef(joinPath(workspace, `${SEGMENT_CACHE}/${source.key}.mp3`)));
      } else if (source.kind === 'clip') {
        const start = source.start + from;
        const end = source.start + to;
        key = `clip:${source.path}:${start}:${end}`;
        url = listeningApi.rangeUrl(target, source.path, start, end);
      } else throw new Error('AUDIO_PREVIEW_UNSUPPORTED');
      const hit = decoded.get(key);
      if (hit) {
        decoded.delete(key);
        decoded.set(key, hit);
        return hit.buffer;
      }
      const loading = pending.get(key);
      if (loading && !loading.signal.aborted) return loading.promise;
      const promise = (async () => {
        const response = await fetch(url, { credentials: 'include', signal });
        if (!response.ok) throw new Error('AUDIO_PREVIEW_FAILED');
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        signal.throwIfAborted();
        remember(key, buffer);
        return buffer;
      })();
      pending.set(key, { signal, promise });
      try {
        return await promise;
      } finally {
        if (pending.get(key)?.promise === promise) pending.delete(key);
      }
    },
  };
}
