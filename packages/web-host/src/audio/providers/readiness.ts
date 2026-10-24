import { access } from 'node:fs/promises';
import type { AudioCapabilities, AudioReadiness } from '../../../../desktop/src/common/types/platform/audioTools.ts';
import { audioPython } from './edge.js';
import { runProcess } from './media.js';

let pending:
  | { until: number; value: Promise<{ tts: AudioReadiness; render: AudioReadiness; tools: AudioReadiness }> }
  | undefined;
/** Probe executables without cloud calls. Short-lived memoization keeps editor polling inexpensive. */
export async function audioCapabilities(hasKey: boolean, uploadMaxBytes: number): Promise<AudioCapabilities> {
  if (!pending || Date.now() > pending.until) {
    const check = async (command: string, args: string[]): Promise<AudioReadiness> => {
      try {
        await runProcess(command, args, AbortSignal.timeout(10000));
        return { available: true };
      } catch {
        return { available: false, reason: 'AUDIO_DEPENDENCY_UNAVAILABLE' };
      }
    };
    pending = {
      until: Date.now() + 10000,
      value: (async () => {
        const [encoder, probe, tts] = await Promise.all([
          check(process.env.AIONUI_FFMPEG ?? 'ffmpeg', ['-version']),
          check(process.env.AIONUI_FFPROBE ?? 'ffprobe', ['-version']),
          check(audioPython(), ['-c', 'import edge_tts']),
        ]);
        let tools: AudioReadiness = { available: false, reason: 'AUDIO_UNAVAILABLE' };
        if (process.env.AIONUI_MANAGED_CODEX_LAUNCHER) {
          try {
            await access(process.env.AIONUI_MANAGED_CODEX_LAUNCHER);
            tools = { available: true };
          } catch {
            /* Report unavailable, never fall back to a global CLI. */
          }
        }
        return {
          tts,
          tools,
          render:
            encoder.available && probe.available
              ? { available: true }
              : { available: false, reason: 'AUDIO_DEPENDENCY_UNAVAILABLE' },
        };
      })(),
    };
  }
  const value = await pending.value;
  return {
    ...value,
    uploadMaxBytes,
    transcription: { hasKey, ...(hasKey ? value.render : { available: false, reason: 'AUDIO_KEY_REQUIRED' }) },
  };
}
