import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';
import { scheduleChime } from '@/renderer/pages/listening/playback/chime';
import { createSources, DECODED_CACHE_BYTES } from '@/renderer/pages/listening/playback/sources';
import {
  playableEntries,
  Scheduler,
  type AudioSources,
  type PlayableEntry,
  type SchedulerEvents,
} from '@/renderer/pages/listening/playback/scheduler';

type Started = { when: number; offset: number; duration: number; buffer: unknown };

/** Minimal AudioContext: time moves only when the test sets it; suspend freezes it. */
function fakeContext() {
  const started: Started[] = [];
  const oscillators: { frequency: number; start: number; stop: number; gain: [string, number, number][] }[] = [];
  const context = {
    currentTime: 0,
    state: 'running' as AudioContextState,
    destination: {},
    started,
    oscillators,
    createBufferSource() {
      const node = {
        buffer: undefined as unknown,
        connect: vi.fn(),
        disconnect: vi.fn(),
        stop: vi.fn(),
        start: (when: number, offset: number, duration: number) =>
          started.push({ when, offset, duration, buffer: node.buffer }),
      };
      return node;
    },
    createOscillator() {
      const record = { frequency: 0, start: 0, stop: 0, gain: [] as [string, number, number][] };
      oscillators.push(record);
      return {
        frequency: {
          set value(value: number) {
            record.frequency = value;
          },
        },
        connect: (gain: { record?: typeof record }) => {
          gain.record = record;
          return gain;
        },
        start: (when: number) => {
          record.start = when;
        },
        stop: (when: number) => {
          record.stop = when;
        },
        disconnect: vi.fn(),
      };
    },
    createGain() {
      const node: { record?: (typeof oscillators)[number]; gain: object; connect: () => void; disconnect: () => void } =
        {
          connect: vi.fn(),
          disconnect: vi.fn(),
          gain: {
            setValueAtTime: (value: number, time: number) => node.record?.gain.push(['set', value, time]),
            linearRampToValueAtTime: (value: number, time: number) => node.record?.gain.push(['ramp', value, time]),
          },
        };
      return node;
    },
    suspend: vi.fn(async () => {
      context.state = 'suspended';
    }),
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
  };
  return context;
}

const entry = (
  start: number,
  end: number,
  source: PlayableEntry['source'],
  segmentId = `seg-${start}`
): PlayableEntry => ({
  sectionId: 's1',
  segmentId,
  type: source.kind === 'silence' ? 'pause' : source.kind,
  play: 1,
  start,
  end,
  estimated: false,
  source,
});

describe('playback scheduler', () => {
  let context: ReturnType<typeof fakeContext>;
  let events: { [K in keyof SchedulerEvents]: ReturnType<typeof vi.fn> };
  let load: ReturnType<typeof vi.fn>;
  let scheduler: Scheduler;
  const advance = async (seconds: number) => {
    context.currentTime += seconds;
    await vi.advanceTimersByTimeAsync(250);
  };
  beforeEach(() => {
    vi.useFakeTimers();
    context = fakeContext();
    events = {
      onTime: vi.fn(),
      onBuffering: vi.fn(),
      onEnded: vi.fn(),
      onSourceError: vi.fn(),
      onUngenerated: vi.fn(),
    };
    load = vi.fn(async (item: PlayableEntry, from: number, to: number) => ({ id: item.segmentId, from, to }));
    scheduler = new Scheduler(
      context as unknown as BaseAudioContext,
      { load } as unknown as AudioSources,
      events as unknown as SchedulerEvents
    );
  });
  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });
  const basic = () => [
    entry(0, 2, { kind: 'speech', key: 'k1', generated: true }, 'a'),
    entry(2, 3, { kind: 'silence' }, 'p'),
    entry(3, 6, { kind: 'clip', path: 'audio/source.mp3', start: 10, end: 13 }, 'c'),
  ];

  it('schedules speech and clips at their track times', async () => {
    scheduler.play(basic(), 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(context.started).toEqual([
      { when: 0, offset: 0, duration: 2, buffer: { id: 'a', from: 0, to: 2 } },
      { when: 3, offset: 0, duration: 3, buffer: { id: 'c', from: 0, to: 3 } },
    ]);
  });

  it('starts part-way into the entry under the playhead and skips earlier ones', async () => {
    scheduler.play(basic(), 3.5);
    await vi.advanceTimersByTimeAsync(0);
    expect(context.started).toEqual([{ when: 0, offset: 0.5, duration: 2.5, buffer: { id: 'c', from: 0, to: 3 } }]);
  });

  it('loads only what lies within the look-ahead window', async () => {
    scheduler.play([...basic(), entry(20, 22, { kind: 'speech', key: 'k2', generated: true }, 'late')], 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(load.mock.calls.map(([item]) => item.segmentId)).toEqual(['a', 'c']);
    await advance(11);
    expect(load.mock.calls.map(([item]) => item.segmentId)).toContain('late');
  });

  it('streams a long clip in 30-second ranges', async () => {
    scheduler.play([entry(0, 70, { kind: 'clip', path: 'a.mp3', start: 0, end: 70 }, 'long')], 0);
    await vi.advanceTimersByTimeAsync(0);
    for (let step = 0; step < 8; step++) await advance(10);
    expect(load.mock.calls.map(([, from, to]) => [from, to])).toEqual([
      [0, 30],
      [30, 60],
      [60, 70],
    ]);
    expect(context.started.map((item) => item.when)).toEqual([0, 30, 60]);
  });

  it('pauses for a slow load and resumes when it arrives', async () => {
    let release: (value: unknown) => void = () => {};
    load.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    scheduler.play(basic(), 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(events.onBuffering).toHaveBeenLastCalledWith(true);
    expect(context.state).toBe('suspended');
    release({ id: 'a' });
    await vi.advanceTimersByTimeAsync(250);
    expect(events.onBuffering).toHaveBeenLastCalledWith(false);
    expect(context.state).toBe('running');
    expect(context.started.find((item) => (item.buffer as { id: string }).id === 'a')).toMatchObject({ when: 0 });
  });

  it('reports a failed source and keeps playing what follows', async () => {
    load.mockImplementationOnce(async () => {
      throw new Error('AUDIO_RANGE_INVALID');
    });
    scheduler.play(basic(), 0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(events.onSourceError).toHaveBeenCalledWith(expect.objectContaining({ segmentId: 'a' }), expect.any(Error));
    expect(context.started.map((item) => (item.buffer as { id: string }).id)).toEqual(['c']);
    expect(context.state).toBe('running');
  });

  it('plays silence for an ungenerated line and flags it when reached', async () => {
    scheduler.play([entry(0, 2, { kind: 'speech', key: 'k1', generated: false }, 'todo'), ...basic().slice(2)], 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(load.mock.calls.map(([item]) => item.segmentId)).toEqual(['c']);
    expect(events.onUngenerated).toHaveBeenCalledWith('todo');
    expect(context.started.map((item) => (item.buffer as { id: string }).id)).toEqual(['c']);
  });

  it('reports the end of the track', async () => {
    scheduler.play(basic(), 0);
    await vi.advanceTimersByTimeAsync(0);
    await advance(6);
    expect(events.onEnded).toHaveBeenCalled();
  });

  it('buffers immediately for an unloaded current source without losing its opening audio', () => {
    load.mockImplementation(() => new Promise(() => {}));
    scheduler.play(basic(), 0);
    expect(events.onBuffering).toHaveBeenCalledWith(true);
    expect(context.suspend).toHaveBeenCalledOnce();
  });

  it('ignores a pending decode that finishes after playback was paused', async () => {
    let release: (buffer: unknown) => void = () => {};
    load.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    scheduler.play([basic()[0]], 0);
    scheduler.pause();
    release({ id: 'late' });
    await vi.advanceTimersByTimeAsync(250);
    expect(context.started).toHaveLength(0);
    expect(events.onBuffering).toHaveBeenLastCalledWith(false);
  });

  it('seeks into the correct chunk of a long recording without decoding earlier chunks', async () => {
    scheduler.play([entry(0, 70, { kind: 'clip', path: 'a.mp3', start: 10, end: 80 }, 'long')], 45);
    await vi.advanceTimersByTimeAsync(0);
    expect(load.mock.calls.map(([, from, to]) => [from, to])).toEqual([[30, 60]]);
    expect(context.started[0]).toMatchObject({ when: 0, offset: 15, duration: 15 });
  });
});

describe('preview audio sources', () => {
  const target = { conversation_id: 'c1', path: 'listening/unit.listening.json' };
  const controller = () => new AbortController();
  let fetchAudio: ReturnType<typeof vi.fn>;
  let decode: ReturnType<typeof vi.fn>;
  let sources: AudioSources;
  beforeEach(() => {
    fetchAudio = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
    decode = vi.fn(async () => ({ length: 24000, numberOfChannels: 1 }));
    vi.stubGlobal('fetch', fetchAudio);
    sources = createSources({ decodeAudioData: decode } as unknown as BaseAudioContext, target, '/ws');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the requested source range using its original source offset', async () => {
    await sources.load(
      entry(0, 70, { kind: 'clip', path: 'audio/a.mp3', start: 10, end: 80 }),
      30,
      60,
      controller().signal
    );
    const [url, options] = fetchAudio.mock.calls[0] as unknown as [string, RequestInit];
    const query = new URL(url, 'http://localhost').searchParams;
    expect([query.get('source'), query.get('start'), query.get('end')]).toEqual(['audio/a.mp3', '40', '70']);
    expect(options.credentials).toBe('include');
  });

  it('reuses the same decoded speech buffer for repeated lines and concurrent loads', async () => {
    const line = entry(0, 2, { kind: 'speech', key: 'ka', generated: true });
    const signal = controller().signal;
    await Promise.all([sources.load(line, 0, 2, signal), sources.load(line, 0, 2, signal)]);
    await sources.load(line, 0, 2, signal);
    expect(fetchAudio).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledOnce();
  });

  it('evicts older decoded buffers at the memory cap', async () => {
    decode.mockResolvedValue({ length: DECODED_CACHE_BYTES / 4, numberOfChannels: 1 });
    const line = (key: string) => entry(0, 2, { kind: 'speech', key, generated: true });
    const signal = controller().signal;
    await sources.load(line('a'), 0, 2, signal);
    await sources.load(line('b'), 0, 2, signal);
    await sources.load(line('a'), 0, 2, signal);
    expect(fetchAudio).toHaveBeenCalledTimes(3);
  });

  it('does not cache a failed request, so playback can be retried', async () => {
    fetchAudio.mockResolvedValueOnce({ ok: false });
    const line = entry(0, 2, { kind: 'speech', key: 'ka', generated: true });
    const signal = controller().signal;
    await expect(sources.load(line, 0, 2, signal)).rejects.toThrow('AUDIO_PREVIEW_FAILED');
    await sources.load(line, 0, 2, signal);
    expect(fetchAudio).toHaveBeenCalledTimes(2);
  });

  it('does not fetch audio for an aborted playback', async () => {
    const abort = controller();
    abort.abort();
    await expect(
      sources.load(entry(0, 2, { kind: 'speech', key: 'ka', generated: true }), 0, 2, abort.signal)
    ).rejects.toThrow();
    expect(fetchAudio).not.toHaveBeenCalled();
  });
});

describe('chime preview', () => {
  it('matches the host tone: two faded 0.35 s beeps, rising for start', () => {
    const context = fakeContext();
    scheduleChime(context as unknown as BaseAudioContext, 'start', 1, context.destination as AudioNode);
    const round = (value: number) => Math.round(value * 1000) / 1000;
    expect(context.oscillators.map((item) => [item.frequency, round(item.start), round(item.stop)])).toEqual([
      [660, 1, 1.35],
      [880, 1.45, 1.8],
    ]);
    expect(context.oscillators[0].gain.map(([kind, value, time]) => [kind, value, round(time)])).toEqual([
      ['set', 0, 1],
      ['ramp', 0.4, 1.02],
      ['set', 0.4, 1.25],
      ['ramp', 0, 1.35],
    ]);
    const end = fakeContext();
    scheduleChime(end as unknown as BaseAudioContext, 'end', 0, end.destination as AudioNode);
    expect(end.oscillators.map((item) => item.frequency)).toEqual([880, 660]);
  });
});

describe('playable entries', () => {
  it('marks generated speech, silence, chimes and clips from the project and its cache state', () => {
    const project = {
      version: 1,
      title: 'Unit',
      defaults: { voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' },
      lexicon: [],
      sections: [
        {
          id: 's1',
          plays: 1,
          gapBetweenPlays: 5,
          gapAfter: 3,
          segments: [
            { id: 'a', type: 'speech', text: '早晨' },
            { id: 'b', type: 'speech', text: '你好' },
            { id: 'c', type: 'chime', preset: 'end' },
            { id: 'k', type: 'clip', path: 'x.mp3', start: 1, end: 2 },
          ],
        },
      ],
    } as ListeningProject;
    const state = {
      segments: { a: { key: 'ka', cached: true, duration: 1.5 }, b: { key: 'kb', cached: false } },
    } as unknown as ListeningState;
    expect(playableEntries(project, state).map((item) => [item.segmentId, item.source, item.end - item.start])).toEqual(
      [
        ['a', { kind: 'speech', key: 'ka', generated: true }, 1.5],
        ['b', { kind: 'speech', key: 'kb', generated: false }, expect.any(Number)],
        ['c', { kind: 'chime', preset: 'end' }, expect.closeTo(0.8)],
        ['k', { kind: 'clip', path: 'x.mp3', start: 1, end: 2 }, 1],
      ]
    );
  });
});
