import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import type { StudioMedia, StudioProject } from '@/common/types/platform/audioStudio';
import type { AudioTaskView } from '@/common/types/platform/audioTools';
import type { ListeningProject, ListeningSegment, ListeningState } from '@/common/types/platform/listeningProject';
import StudioLibraryPage from '@/renderer/pages/studio';
import StudioEditorPage from '@/renderer/pages/studio/StudioEditorPage';

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/common/adapter/httpBridge', async (original) => ({
  ...(await original<object>()),
  httpRequest: transport.request,
}));

const summary: StudioProject = {
  id: 'p1',
  title: '第一課',
  workspace: '/data/audio-projects/u/p1',
  projectPath: 'project.listening.json',
  segments: 0,
  createdAt: 1,
  updatedAt: 2,
};
const empty: ListeningProject = {
  version: 1,
  title: '第一課',
  defaults: { voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' },
  lexicon: [],
  sections: [{ id: 'main', plays: 1, gapBetweenPlays: 0, gapAfter: 0, segments: [] }],
};
const ready = { available: true };
const clipSegment = (id: string, start: number, end: number, text?: string): ListeningSegment => ({
  id,
  type: 'clip',
  path: 'media/talk.mp3',
  start,
  end,
  ...(text ? { transcript: { text, source: 'auto', verified: false } } : {}),
});
const transcriptTask: AudioTaskView = {
  id: 't1',
  kind: 'transcript',
  status: 'completed',
  createdAt: 1,
  updatedAt: 2,
  initiator: 'user',
  projectPath: 'project.listening.json',
  segmentIds: ['c1'],
  transcripts: {
    c1: { path: 'media/talk.mp3', start: 0, end: 10, text: '重新轉寫的文字', cues: [] },
  },
  completedChunks: 1,
  totalChunks: 1,
  files: [],
  warnings: [],
};
let media: StudioMedia[];
let state: ListeningState;

const show = (entry: string) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path='/audio' element={<StudioLibraryPage />} />
          <Route path='/audio/:projectId' element={<StudioEditorPage />} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>
  );

describe('audio studio pages', () => {
  beforeEach(() => {
    media = [];
    state = {
      path: 'project.listening.json',
      revision: 'r1',
      project: empty,
      segments: {},
      qaThreshold: 0.9,
      tasks: [],
    };
    transport.request.mockReset().mockImplementation(async (method: string, path: string, body?: unknown) => {
      const route = String(path);
      if (route === '/api/edu/audio/studio/projects' && method === 'GET') return [summary];
      if (route === '/api/edu/audio/studio/projects' && method === 'POST')
        return { ...summary, id: 'p2', title: (body as { title: string }).title };
      if (route.startsWith('/api/edu/audio/studio/projects/p1/media/blocks'))
        return {
          version: 1,
          path: 'media/talk.mp3',
          durationSeconds: 30,
          warnings: [],
          blocks: [
            { start: 0, end: 11, text: '大家好，今日講天氣。' },
            { start: 11, end: 30, text: '明天會下雨。' },
          ],
        };
      if (route === '/api/edu/audio/studio/projects/p1/media') return media;
      if (route === '/api/edu/audio/capabilities')
        return {
          uploadMaxBytes: 1024,
          tools: ready,
          transcription: { ...ready, hasKey: true },
          tts: ready,
          render: ready,
        };
      if (route === '/api/edu/audio/listening/transcripts') {
        const queued = { ...transcriptTask, status: 'queued' as const };
        // The next poll reports the task finished with fresh text for the clip.
        state = { ...state, tasks: [transcriptTask] };
        return { taskId: 't1', state: { ...state, tasks: [queued] } };
      }
      if (route.startsWith('/api/edu/audio/listening') && method === 'PUT')
        return { ...state, revision: 'r2', project: (body as { project: ListeningProject }).project };
      if (route.startsWith('/api/edu/audio/listening')) return state;
      return {};
    });
  });
  afterEach(cleanup);

  it('lists projects and opens the editor for a new one', async () => {
    show('/audio');
    expect(await screen.findByText('第一課')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'messages.studio.library.new' }));
    fireEvent.click(await screen.findByRole('button', { name: 'common.create' }));
    await vi.waitFor(() =>
      expect(transport.request).toHaveBeenCalledWith(
        'POST',
        '/api/edu/audio/studio/projects',
        { title: 'messages.studio.library.defaultTitle' },
        { sensitive: true }
      )
    );
    // p2 is not in the mocked list, so the editor route reports it as missing.
    expect(await screen.findByText('messages.studio.errors.projectNotFound')).toBeTruthy();
  });

  it('loads a studio project by id without a conversation', async () => {
    show('/audio/p1');
    expect(await screen.findByDisplayValue('第一課')).toBeTruthy();
    expect(transport.request).toHaveBeenCalledWith('GET', '/api/edu/audio/listening?project_id=p1', undefined, {
      sensitive: true,
    });
    expect(transport.request).toHaveBeenCalledWith('GET', '/api/edu/audio/capabilities', undefined, {
      sensitive: true,
    });
    expect(await screen.findByText('messages.studio.media.empty')).toBeTruthy();
    // Studio projects insert recordings from the media panel, not the listening-test inserts.
    expect(screen.queryByRole('button', { name: 'messages.listening.insert.chime' })).toBeNull();
    expect(screen.getByRole('button', { name: 'messages.listening.insert.speech' })).toBeTruthy();
  });

  it('adds a recording’s transcribed blocks to the timeline', async () => {
    media = [
      {
        path: 'media/talk.mp3',
        name: 'talk.mp3',
        bytes: 10,
        addedAt: 1,
        durationSeconds: 30,
        blocks: 2,
        transcribed: true,
      },
    ];
    show('/audio/p1');
    const panel = await screen.findByRole('complementary', { name: 'messages.studio.media.title' });
    fireEvent.click(await within(panel).findByRole('button', { name: /messages.studio.media.add/ }));
    expect(await screen.findByText('大家好，今日講天氣。')).toBeTruthy();
    expect(screen.getByText('明天會下雨。')).toBeTruthy();
  });

  it('finds words in clip transcripts and selects the matching block', async () => {
    state = {
      ...state,
      project: {
        ...empty,
        sections: [
          {
            ...empty.sections[0],
            segments: [
              clipSegment('c1', 0, 10, '大家好。'),
              clipSegment('c2', 10, 20, '明天會下雨。'),
              clipSegment('c3', 20, 30, '帶雨傘。'),
            ],
          },
        ],
      },
    };
    const { container } = show('/audio/p1');
    const search = await screen.findByRole('textbox', { name: 'messages.listening.search.placeholder' });
    fireEvent.change(search, { target: { value: '雨' } });
    fireEvent.keyDown(search, { key: 'Enter', keyCode: 13 });
    await vi.waitFor(() =>
      expect(container.querySelector('[data-selected="true"] [data-segment-id]')?.getAttribute('data-segment-id')).toBe(
        'c2'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.search.next' }));
    await vi.waitFor(() =>
      expect(container.querySelector('[data-selected="true"] [data-segment-id]')?.getAttribute('data-segment-id')).toBe(
        'c3'
      )
    );
  });

  it('transcribes clips that need text and applies the result to the draft', async () => {
    state = {
      ...state,
      project: {
        ...empty,
        sections: [
          {
            ...empty.sections[0],
            segments: [{ ...clipSegment('c1', 0, 10), warnings: ['AUDIO_TRANSCRIPT_STALE'] }],
          },
        ],
      },
    };
    show('/audio/p1');
    fireEvent.click(await screen.findByRole('button', { name: /messages.listening.transcribe.all/ }));
    await vi.waitFor(() =>
      expect(transport.request).toHaveBeenCalledWith(
        'POST',
        '/api/edu/audio/listening/transcripts',
        { project_id: 'p1', revision: 'r1', segment_ids: ['c1'] },
        { sensitive: true }
      )
    );
    // Applied after the next poll (1.5 s while a task runs).
    expect(await screen.findByText('重新轉寫的文字', undefined, { timeout: 4000 })).toBeTruthy();
  });

  it('shows a missing project instead of an empty editor', async () => {
    show('/audio/unknown');
    expect(await screen.findByText('messages.studio.errors.projectNotFound')).toBeTruthy();
  });
});
