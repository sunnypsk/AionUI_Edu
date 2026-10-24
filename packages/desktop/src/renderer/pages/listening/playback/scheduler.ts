/** Live preview: plays the laid-out track in the browser by scheduling decoded pieces on an AudioContext. */
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';
import { layoutTimeline, sequenceTrack, type LaidOutEntry } from '@/common/types/platform/listeningTimeline';
import { scheduleChime } from '@/renderer/pages/listening/playback/chime';
import { stateDurations } from '@/renderer/pages/listening/timeline/blocks';

export const LOOKAHEAD_SECONDS = 10;
export const RANGE_CHUNK_SECONDS = 30;
const TICK_MS = 250;
/** A piece that should already be playing within this margin but has not loaded pauses playback. */
const LATE_SECONDS = 0.1;

export type PlayableSource =
  | { kind: 'speech'; key: string; generated: boolean }
  | { kind: 'clip'; path: string; start: number; end: number }
  | { kind: 'silence' }
  | { kind: 'chime'; preset: 'start' | 'end' };
export type PlayableEntry = LaidOutEntry & { source: PlayableSource };

/** Decoded audio for `[from, to)` seconds into an entry (clips are fetched in ranges). */
export type AudioSources = {
  load(entry: PlayableEntry, from: number, to: number, signal: AbortSignal): Promise<AudioBuffer>;
};
export type SchedulerEvents = {
  onTime(time: number): void;
  onBuffering(buffering: boolean): void;
  onEnded(): void;
  onSourceError(entry: PlayableEntry, error: unknown): void;
  onUngenerated(segmentId: string): void;
};

/** Every piece of the track in playback order, with what to play for it. */
export function playableEntries(project: ListeningProject, state: ListeningState): PlayableEntry[] {
  const sequence = sequenceTrack(project);
  return layoutTimeline(sequence, project, stateDurations(state)).entries.map((entry, index) => {
    const item = sequence[index];
    if (item.kind === 'gap') return { ...entry, source: { kind: 'silence' } };
    const segment = item.segment;
    const source: PlayableSource =
      segment.type === 'speech'
        ? {
            kind: 'speech',
            key: state.segments[segment.id]?.key ?? '',
            generated: !!state.segments[segment.id]?.cached,
          }
        : segment.type === 'clip'
          ? { kind: 'clip', path: segment.path, start: segment.start, end: segment.end }
          : segment.type === 'chime'
            ? { kind: 'chime', preset: segment.preset }
            : { kind: 'silence' };
    return { ...entry, source };
  });
}

type Unit = {
  key: string;
  entry: PlayableEntry;
  /** Track time this unit starts and ends. */
  start: number;
  end: number;
  /** Offsets into the entry. */
  from: number;
  to: number;
};
type UnitState =
  | { status: 'pending' }
  | { status: 'ready'; buffer: AudioBuffer }
  | { status: 'failed'; error: unknown }
  | { status: 'done' };

/** Split entries into schedulable units: one per entry, or 30-second ranges for clips. */
function unitsOf(entries: PlayableEntry[]): Unit[] {
  const units: Unit[] = [];
  entries.forEach((entry, index) => {
    if (entry.source.kind === 'silence') return;
    const length = entry.end - entry.start;
    const step = entry.source.kind === 'clip' ? RANGE_CHUNK_SECONDS : length;
    for (let from = 0, chunk = 0; from < length - 1e-6; from += step, chunk++) {
      const to = Math.min(length, from + step);
      units.push({ key: `${index}:${chunk}`, entry, start: entry.start + from, end: entry.start + to, from, to });
    }
  });
  return units;
}

export class Scheduler {
  private units: Unit[] = [];
  private states = new Map<string, UnitState>();
  private playing = new Set<{ stop: () => void }>();
  private origin = 0;
  private duration = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private abort = new AbortController();
  private buffering = false;
  private active = false;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly sources: AudioSources,
    private readonly events: SchedulerEvents
  ) {}

  /** Track time from the context clock; frozen while the context is suspended for buffering. */
  private now(): number {
    return this.context.currentTime - this.origin;
  }

  play(entries: PlayableEntry[], from: number): void {
    this.stopSources();
    this.abort.abort();
    this.abort = new AbortController();
    this.units = unitsOf(entries);
    this.states = new Map();
    this.duration = entries.length ? entries[entries.length - 1].end : 0;
    this.origin = this.context.currentTime - from;
    this.active = true;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  pause(): number {
    const time = this.now();
    this.halt();
    return time;
  }

  dispose(): void {
    this.halt();
  }

  private halt(): void {
    this.active = false;
    clearInterval(this.timer);
    this.abort.abort();
    this.stopSources();
    this.setBuffering(false);
  }

  private stopSources(): void {
    this.playing.forEach((node) => node.stop());
    this.playing.clear();
  }

  private setBuffering(value: boolean): void {
    if (this.buffering === value) return;
    this.buffering = value;
    const context = this.context as AudioContext;
    void (value ? context.suspend?.() : context.resume?.());
    this.events.onBuffering(value);
  }

  private request(unit: Unit): void {
    this.states.set(unit.key, { status: 'pending' });
    const signal = this.abort.signal;
    this.sources.load(unit.entry, unit.from, unit.to, signal).then(
      (buffer) => {
        if (signal.aborted) return;
        this.states.set(unit.key, { status: 'ready', buffer });
        this.tick();
      },
      (error: unknown) => {
        if (signal.aborted) return;
        this.states.set(unit.key, { status: 'failed', error });
        this.tick();
      }
    );
  }

  /** Start a loaded unit at its track time, or part-way through when the playhead is already inside it. */
  private start(unit: Unit, time: number): void {
    const state = this.states.get(unit.key);
    const offset = Math.max(0, time - unit.start);
    const when = this.origin + unit.start + offset;
    if (state?.status === 'ready') {
      const node = this.context.createBufferSource();
      node.buffer = state.buffer;
      node.connect(this.context.destination);
      const playing = {
        stop: () => {
          node.stop();
          node.disconnect();
        },
      };
      node.onended = () => {
        this.playing.delete(playing);
        node.disconnect();
      };
      node.start(when, offset, unit.to - unit.from - offset);
      this.playing.add(playing);
    } else if (state?.status === 'failed') this.events.onSourceError(unit.entry, state.error);
    this.states.set(unit.key, { status: 'done' });
  }

  private tick(): void {
    if (!this.active) return;
    const time = this.now();
    this.events.onTime(Math.min(time, this.duration));
    if (time >= this.duration) {
      this.halt();
      this.events.onEnded();
      return;
    }
    let late = false;
    for (const unit of this.units) {
      if (unit.end <= time || unit.start > time + LOOKAHEAD_SECONDS) continue;
      const source = unit.entry.source;
      const state = this.states.get(unit.key);
      if (source.kind === 'speech' && !source.generated) {
        // Ungenerated lines play as silence; tell the editor when the playhead reaches one.
        if (unit.start <= time && !state) {
          this.states.set(unit.key, { status: 'done' });
          this.events.onUngenerated(unit.entry.segmentId!);
        }
      } else if (source.kind === 'chime') {
        // A chime is synthesized on the spot; one cut off by a seek is skipped rather than started mid-beep.
        if (!state) {
          this.states.set(unit.key, { status: 'done' });
          if (unit.start >= time)
            this.playing.add({
              stop: scheduleChime(this.context, source.preset, this.origin + unit.start, this.context.destination),
            });
        }
      } else if (!state) {
        this.request(unit);
        late ||= unit.start <= time + LATE_SECONDS;
      } else if (state.status === 'pending') late ||= unit.start <= time + LATE_SECONDS;
      else if (state.status !== 'done') this.start(unit, time);
    }
    this.setBuffering(late);
  }
}
