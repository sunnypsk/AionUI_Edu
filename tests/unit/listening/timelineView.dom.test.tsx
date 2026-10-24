import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Input } from '@arco-design/web-react';
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';
import type { Selection } from '@/renderer/pages/listening/editing/useSelection';
import { useEditorShortcuts } from '@/renderer/pages/listening/editing/useEditorShortcuts';
import { Timeline } from '@/renderer/pages/listening/timeline/Timeline';

const PX = 10;
const target = { conversation_id: 'c1', path: 'listening/unit.listening.json' };
const base = (sections: ListeningProject['sections']): ListeningProject => ({
  version: 1,
  title: 'Unit',
  defaults: { voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' },
  lexicon: [],
  sections,
});
const twoSections = () =>
  base([
    {
      id: 's1',
      plays: 2,
      gapBetweenPlays: 5,
      gapAfter: 3,
      segments: [
        { id: 'k', type: 'clip', path: 'audio/source.mp3', start: 0, end: 10 },
        { id: 'p', type: 'pause', seconds: 2 },
      ],
    },
    { id: 's2', plays: 1, gapBetweenPlays: 5, gapAfter: 3, segments: [{ id: 'a', type: 'speech', text: '早晨' }] },
  ]);
const state = (segments: ListeningState['segments'] = {}): ListeningState => ({
  path: target.path,
  revision: 'r1',
  qaThreshold: 0.9,
  segments,
  tasks: [],
});

/** 60 seconds of peaks so trims can extend up to the source length. */
const peaksResponse = () => {
  const bytes = new Uint8Array(16 + 12000);
  const view = new DataView(bytes.buffer);
  [...'LPK1'].forEach((char, index) => view.setUint8(index, char.charCodeAt(0)));
  view.setUint32(4, 10, true);
  view.setUint32(8, 6000, true);
  return { ok: true, arrayBuffer: async () => bytes.buffer };
};

function Harness({
  initial,
  segments,
  onSelection,
}: {
  initial: ListeningProject;
  segments?: ListeningState['segments'];
  onSelection?: (selection: Selection) => void;
}) {
  const [project, setProject] = useState(initial);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const select = (next: Selection) => {
    setSelection(next);
    onSelection?.(next);
  };
  return (
    <>
      <Timeline
        project={project}
        state={state(segments)}
        target={target}
        selection={selection}
        disabled={false}
        pxPerSec={PX}
        playhead={0}
        onSeek={vi.fn()}
        onWheel={vi.fn()}
        onSelect={select}
        onSelectSegment={(sectionId, id) => select({ kind: 'segments', sectionId, ids: [id] })}
        onEdit={(change) => setProject(change)}
      />
      <pre data-testid='project'>{JSON.stringify(project.sections)}</pre>
    </>
  );
}

const sections = () => JSON.parse(screen.getByTestId('project').textContent!) as ListeningProject['sections'];
const block = (id: string) => document.querySelector(`[data-block="${id}"]`) as HTMLElement;
const drag = async (element: Element, from: number, to: number, options: { shiftKey?: boolean } = {}) => {
  fireEvent.mouseDown(element, { button: 0, clientX: from, ...options });
  fireEvent.mouseMove(window, { clientX: to });
  await act(async () => {
    fireEvent.mouseUp(window, { clientX: to, ...options });
  });
};

describe('Timeline view', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => peaksResponse())
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('draws blocks in authored order with a repeat summary sized from real and estimated lengths', () => {
    render(<Harness initial={twoSections()} />);
    expect(block('k').style.width).toBe('100px');
    expect(block('p').style.left).toBe('100px');
    const repeat = document.querySelector('[data-kind="repeat"]') as HTMLElement;
    // (plays - 1) × (gap 5 + first play 12 s) at 10 px/s.
    expect(repeat.style.width).toBe('170px');
    expect(screen.getByText('messages.listening.timeline.repeat')).toBeTruthy();
    expect(block('a').getAttribute('data-estimated')).toBe('true');
  });

  it('only mounts blocks near the visible part of long projects', () => {
    const many = base([
      {
        id: 's1',
        plays: 1,
        gapBetweenPlays: 5,
        gapAfter: 3,
        segments: Array.from({ length: 500 }, (_, index) => ({ id: `p${index}`, type: 'pause' as const, seconds: 5 })),
      },
    ]);
    render(<Harness initial={many} />);
    const mounted = document.querySelectorAll('[data-block]').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(100);
  });

  it('selects a block on click', async () => {
    const onSelection = vi.fn();
    render(<Harness initial={twoSections()} onSelection={onSelection} />);
    await drag(block('p').querySelector('[data-grip]')!, 105, 105);
    expect(onSelection).toHaveBeenLastCalledWith({ kind: 'segments', sectionId: 's1', ids: ['p'] });
  });

  it('selects a source range by dragging across a clip waveform, snapping to the clip edge', async () => {
    const onSelection = vi.fn();
    render(<Harness initial={twoSections()} onSelection={onSelection} />);
    await drag(block('k').querySelector('[data-body]')!, 20, 40);
    expect(onSelection).toHaveBeenLastCalledWith({ kind: 'range', clipId: 'k', start: 2, end: 4 });
    await drag(block('k').querySelector('[data-body]')!, 3, 40);
    expect(onSelection).toHaveBeenLastCalledWith({ kind: 'range', clipId: 'k', start: 0, end: 4 });
  });

  it('trims a clip edge and resizes a pause by dragging', async () => {
    render(<Harness initial={twoSections()} />);
    await act(async () => {}); // peaks
    await drag(block('k').querySelector('[data-handle="end"]')!, 100, 120);
    expect(sections()[0].segments[0]).toMatchObject({ start: 0, end: 12 });
    await drag(block('p').querySelector('[data-handle="end"]')!, 140, 150);
    expect(sections()[0].segments[1]).toMatchObject({ seconds: 3 });
  });

  it('moves a block into another section by dragging its grip', async () => {
    render(<Harness initial={twoSections()} />);
    const target = block('a');
    const right = Number.parseFloat(target.style.left) + Number.parseFloat(target.style.width);
    await drag(block('p').querySelector('[data-grip]')!, 105, right - 1);
    expect(sections()[0].segments.map((segment) => segment.id)).toEqual(['k']);
    expect(sections()[1].segments.map((segment) => segment.id)).toEqual(['a', 'p']);
  });
});

describe('editor shortcuts', () => {
  afterEach(cleanup);
  const handlers = () => ({
    togglePlay: vi.fn(),
    split: vi.fn(),
    remove: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    nudge: vi.fn(),
    saveNow: vi.fn(),
  });
  function Shortcuts({ value }: { value: ReturnType<typeof handlers> }) {
    useEditorShortcuts(value);
    return <Input aria-label='notes' />;
  }

  it('maps keys to editor actions when focus is not in a text field', () => {
    const value = handlers();
    render(<Shortcuts value={value} />);
    fireEvent.keyDown(document.body, { key: ' ' });
    fireEvent.keyDown(document.body, { key: 's' });
    fireEvent.keyDown(document.body, { key: 'Delete' });
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
    expect(value.togglePlay).toHaveBeenCalledTimes(1);
    expect(value.split).toHaveBeenCalledTimes(1);
    expect(value.remove).toHaveBeenCalledTimes(1);
    expect(value.undo).toHaveBeenCalledTimes(1);
    expect(value.redo).toHaveBeenCalledTimes(1);
    expect(value.nudge.mock.calls).toEqual([[5], [-1]]);
    expect(value.saveNow).toHaveBeenCalledTimes(1);
  });

  it('leaves keys alone while typing', () => {
    const value = handlers();
    render(<Shortcuts value={value} />);
    const input = screen.getByLabelText('notes');
    for (const key of [' ', 's', 'Delete', 'ArrowLeft']) fireEvent.keyDown(input, { key });
    expect(Object.values(value).every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });
});
