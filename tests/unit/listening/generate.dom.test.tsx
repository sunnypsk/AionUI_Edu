import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';
import type { AudioTaskView } from '@/common/types/platform/audioTools';
import { conversationSource } from '@/renderer/pages/listening/data/source';
import { ListeningEditor } from '@/renderer/pages/listening/layout/ListeningEditor';

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/common/adapter/httpBridge', async (original) => ({
  ...(await original<object>()),
  httpRequest: transport.request,
}));

const project: ListeningProject = {
  version: 1,
  title: '中三聆聽',
  defaults: { voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' },
  lexicon: [],
  sections: [
    {
      id: 's1',
      plays: 1,
      gapBetweenPlays: 5,
      gapAfter: 3,
      segments: [
        { id: 'a', type: 'speech', text: '第一句' },
        { id: 'b', type: 'speech', text: '第二句' },
        { id: 'c', type: 'speech', text: '第三句' },
      ],
    },
  ],
};
const task = (status: AudioTaskView['status'], ids: string[]): AudioTaskView => ({
  id: 'gen1',
  kind: 'segments',
  status,
  createdAt: 1,
  updatedAt: 1,
  totalChunks: ids.length,
  completedChunks: 0,
  files: [],
  warnings: [],
  projectRevision: 'r1',
  segmentIds: ids,
});
let current: ListeningState;
let ttsAvailable = true;
const generated = () => transport.request.mock.calls.filter(([, path]) => String(path).endsWith('/segments/generate'));
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
const show = async () => {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ConversationProvider value={{ conversation_id: 'c1', workspace: '/ws', type: 'codex' }}>
        <ListeningEditor source={conversationSource('c1', '/ws', 'listening/unit.listening.json')} />
      </ConversationProvider>
    </SWRConfig>
  );
  await settle();
};

describe('manual speech generation and export', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ttsAvailable = true;
    current = {
      path: 'listening/unit.listening.json',
      revision: 'r1',
      project,
      qaThreshold: 0.9,
      tasks: [],
      segments: { a: { key: 'ka', cached: false }, b: { key: 'kb', cached: false }, c: { key: 'kc', cached: false } },
    };
    transport.request
      .mockReset()
      .mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
        if (path.includes('/capabilities'))
          return {
            tools: { available: true },
            tts: { available: ttsAvailable },
            render: { available: true },
            transcription: { available: true, hasKey: true },
          };
        if (method === 'PUT') current = { ...current, revision: 'r2', project: body!.project as ListeningProject };
        if (path.endsWith('/segments/generate')) {
          current = {
            ...current,
            tasks: [{ ...task('running', body!.segment_ids as string[]), projectRevision: current.revision }],
          };
          return { taskId: 'gen1', state: current };
        }
        return current;
      });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('invalidates an edited cached line immediately and never generates automatically', async () => {
    current.segments.a = { key: 'ka', cached: true, duration: 2 };
    await show();
    fireEvent.change(screen.getByDisplayValue('第一句'), { target: { value: '新的一句' } });
    fireEvent.click(screen.getByText('messages.listening.view.timeline'));
    expect(document.querySelector('[data-block="a"]')).toHaveAttribute('data-estimated', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(generated()).toHaveLength(0);
  });

  it('saves the edited script before generating just the requested line', async () => {
    await show();
    fireEvent.change(screen.getByDisplayValue('第一句'), { target: { value: '新的一句' } });
    const row = document.querySelector('[data-script-row="a"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'messages.listening.generate.one' }));
    await settle();
    expect(transport.request.mock.calls.filter(([method]) => method === 'PUT')).toHaveLength(1);
    expect(generated()[0][2]).toMatchObject({ revision: 'r2', segment_ids: ['a'] });
  });

  it('generates all three missing lines only after the teacher clicks', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.generate.all' }));
    await settle();
    expect(generated()).toHaveLength(1);
    expect(generated()[0][2]).toMatchObject({ segment_ids: ['a', 'b', 'c'] });
  });

  it('shows running state only on the requested blocks and lets the teacher cancel', async () => {
    current.tasks = [task('running', ['b'])];
    await show();
    fireEvent.click(screen.getByText('messages.listening.view.timeline'));
    expect(
      ['a', 'b', 'c'].map((id) => document.querySelector(`[data-block="${id}"]`)?.getAttribute('data-status'))
    ).toEqual(['idle', 'running', 'idle']);
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.generate.stop' }));
    await settle();
    expect(transport.request.mock.calls.find(([, path]) => String(path).endsWith('/cancel'))?.[2]).toMatchObject({
      task_id: 'gen1',
    });
  });

  it('lets a failed line be retried from its timeline block', async () => {
    current.tasks = [task('failed', ['b'])];
    await show();
    fireEvent.click(screen.getByText('messages.listening.view.timeline'));
    const block = document.querySelector('[data-block="b"]') as HTMLElement;
    expect(block).toHaveAttribute('data-status', 'failed');
    fireEvent.click(within(block).getByRole('button', { name: 'messages.listening.generate.retry' }));
    await settle();
    expect(generated()[0][2]).toMatchObject({ segment_ids: ['b'] });
  });

  it('keeps text editing available but disables generation when TTS is unavailable', async () => {
    ttsAvailable = false;
    await show();
    expect(screen.getByDisplayValue('第一句')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'messages.listening.generate.all' })).toBeDisabled();
    expect(
      screen
        .getAllByRole('button', { name: 'messages.listening.generate.one' })
        .every((button) => button.hasAttribute('disabled'))
    ).toBe(true);
  });

  it('offers render, downloads and QA acceptance in the export menu', async () => {
    current.segments.a = { key: 'ka', cached: true, qa: { heard: '錯字', similarity: 0.5, accepted: false } };
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.export.title' }));
    await settle();
    const panel = screen.getByRole('region', { name: 'messages.listening.export.title' });
    expect(within(panel).getByRole('button', { name: 'messages.listening.actions.render' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'messages.listening.download.mp3' })).toBeDisabled();
    fireEvent.click(within(panel).getByRole('button', { name: 'messages.listening.qa.accept' }));
    await settle();
    expect(transport.request.mock.calls.find(([, path]) => String(path).endsWith('/qa'))?.[2]).toMatchObject({
      segment_id: 'a',
      accepted: true,
    });
  });
});
