import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import ListeningPage from '@/renderer/pages/listening';
import { listeningPagePath } from '@/renderer/pages/listening/route';

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/common/adapter/httpBridge', async (original) => ({
  ...(await original<object>()),
  httpRequest: transport.request,
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: async () => ({ id: 'c1', type: 'codex', extra: { workspace: '/ws' } }),
}));

/** A clock the test moves by hand; pauses and gaps need no decoded audio. */
const clock = vi.hoisted(() => ({ now: 0 }));
class FakeAudioContext {
  destination = {};
  state = 'running';
  get currentTime() {
    return clock.now;
  }
  resume = vi.fn(async () => {});
  suspend = vi.fn(async () => {});
  close = vi.fn(async () => {});
}

// Section 1 plays twice: pause 2 s, gap 1 s, pause 2 s → 5 s in total.
const project = {
  version: 1,
  title: '中三聆聽',
  defaults: { voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' },
  lexicon: [],
  sections: [
    { id: 'part1', plays: 2, gapBetweenPlays: 1, gapAfter: 3, segments: [{ id: 'p1', type: 'pause', seconds: 2 }] },
  ],
};

const show = async () => {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={[listeningPagePath('c1', 'listening/unit.listening.json')]}>
        <Routes>
          <Route path='/conversation/:id/listening' element={<ListeningPage />} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>
  );
  await screen.findByDisplayValue('中三聆聽');
};

describe('live preview playback', () => {
  beforeEach(() => {
    clock.now = 0;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    transport.request.mockReset().mockImplementation(async (_method: string, path: string) =>
      String(path).startsWith('/api/edu/audio/listening')
        ? {
            path: 'listening/unit.listening.json',
            revision: 'r1',
            project,
            qaThreshold: 0.9,
            segments: {},
            tasks: [],
          }
        : {}
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('plays and pauses with the transport button and the space bar, showing the time', async () => {
    await show();
    expect(screen.getByText('0:00.0 / 0:05.0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.player.play' }));
    expect(await screen.findByRole('button', { name: 'messages.listening.player.pause' })).toBeTruthy();
    clock.now = 1.5;
    expect(await screen.findByText('0:01.5 / 0:05.0')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(await screen.findByRole('button', { name: 'messages.listening.player.play' })).toBeTruthy();
    clock.now = 4;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByText('0:01.5 / 0:05.0')).toBeTruthy();
  });

  it('marks the second play of a repeated section on the timeline', async () => {
    await show();
    fireEvent.click(screen.getByText('messages.listening.view.timeline'));
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.player.play' }));
    clock.now = 3.5;
    await waitFor(() => expect(screen.getByText('messages.listening.timeline.playBadge')).toBeTruthy());
  });

  it('notes that preview loudness is not final', async () => {
    await show();
    expect(screen.getByText('messages.listening.player.loudnessNote')).toBeTruthy();
  });
});
