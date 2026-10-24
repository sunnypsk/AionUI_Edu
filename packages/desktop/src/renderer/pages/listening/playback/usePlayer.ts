import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';
import type { ListeningTarget } from '@/renderer/pages/listening/data/api';
import { playableEntries, Scheduler, type PlayableEntry } from '@/renderer/pages/listening/playback/scheduler';
import { createSources } from '@/renderer/pages/listening/playback/sources';

/** How long an ungenerated line stays highlighted after the playhead reaches it. */
const FLASH_MS = 1200;

export type Player = {
  playing: boolean;
  buffering: boolean;
  time: number;
  duration: number;
  entries: PlayableEntry[];
  /** Ungenerated line the preview is playing silence for, briefly. */
  flashing?: string;
  /** Segment whose audio could not be loaded during this playback. */
  failed?: string;
  toggle: () => void;
  seek: (seconds: number) => void;
  nudge: (seconds: number) => void;
};

/**
 * Live preview of the working copy. The AudioContext is created on the first Play (browsers require a
 * user gesture); edits while playing reschedule from the current position.
 */
export function usePlayer(
  project: ListeningProject | undefined,
  state: ListeningState | undefined,
  target: ListeningTarget | undefined,
  workspace: string | undefined
): Player {
  const entries = useMemo(() => (project && state ? playableEntries(project, state) : []), [project, state]);
  const duration = entries.length ? entries[entries.length - 1].end : 0;
  const entriesKey = JSON.stringify(entries);
  const targetKey = target ? `${target.conversation_id}\0${target.path}` : '';
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [time, setTime] = useState(0);
  const [flashing, setFlashing] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const scheduler = useRef<Scheduler | undefined>(undefined);
  const context = useRef<AudioContext | undefined>(undefined);
  const timeRef = useRef(0);
  timeRef.current = time;
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const ensure = useCallback((): Scheduler | undefined => {
    if (scheduler.current) return scheduler.current;
    if (!target || !workspace || typeof AudioContext === 'undefined') return undefined;
    context.current = new AudioContext();
    scheduler.current = new Scheduler(context.current, createSources(context.current, target, workspace), {
      onTime: setTime,
      onBuffering: setBuffering,
      onEnded: () => setPlaying(false),
      onSourceError: (entry) => setFailed(entry.segmentId),
      onUngenerated: (segmentId) => {
        setFlashing(segmentId);
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashing(undefined), FLASH_MS);
      },
    });
    return scheduler.current;
  }, [target, workspace]);

  // Reschedule from the current position when the working copy changes during playback.
  useEffect(() => {
    const next = Math.min(playing ? (scheduler.current?.pause() ?? timeRef.current) : timeRef.current, duration);
    setTime(next);
    if (playing) scheduler.current?.play(entries, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- polling identical entries must not restart playback.
  }, [entriesKey]);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setFailed(undefined);
    setFlashing(undefined);
    return () => {
      scheduler.current?.dispose();
      scheduler.current = undefined;
      clearTimeout(flashTimer.current);
      void context.current?.close?.();
      context.current = undefined;
    };
  }, [targetKey, workspace]);

  const seek = useCallback(
    (seconds: number) => {
      const next = Math.max(0, Math.min(seconds, duration));
      setTime(next);
      if (playing) scheduler.current?.play(entries, next);
    },
    [duration, entries, playing]
  );

  return {
    playing,
    buffering,
    time,
    duration,
    entries,
    flashing,
    failed,
    toggle: () => {
      if (playing) {
        setTime(scheduler.current?.pause() ?? time);
        setPlaying(false);
        return;
      }
      const instance = ensure();
      if (!instance || !entries.length || duration <= 0) return;
      setFailed(undefined);
      void context.current?.resume?.();
      instance.play(entries, time >= duration ? 0 : time);
      setPlaying(true);
    },
    seek,
    nudge: (seconds) => seek(timeRef.current + seconds),
  };
}
