import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import ListeningPage from '@/renderer/pages/listening';
import { listeningPagePath } from '@/renderer/pages/listening/route';

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/common/adapter/httpBridge', async (original) => ({
  ...(await original<object>()),
  httpRequest: transport.request,
}));
const conversations = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: conversations.get,
}));

const project = {
  version: 1,
  title: '中三聆聽',
  defaults: { voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' },
  lexicon: [],
  sections: [
    { id: 'part1', plays: 1, gapBetweenPlays: 5, gapAfter: 3, segments: [{ id: 'p1', type: 'pause', seconds: 3 }] },
  ],
};

const show = (entry: string) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path='/conversation/:id/listening' element={<ListeningPage />} />
          <Route path='/conversation/:id' element={<div>chat page</div>} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>
  );

describe('listening editor page', () => {
  beforeEach(() => {
    conversations.get.mockReset().mockResolvedValue({ id: 'c1', type: 'codex', extra: { workspace: '/ws' } });
    transport.request
      .mockReset()
      .mockImplementation(async (_method: string, path: string) =>
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
  afterEach(cleanup);

  it('builds the page path from the conversation and project', () => {
    expect(listeningPagePath('c1', 'listening/unit.listening.json')).toBe(
      '/conversation/c1/listening?path=listening%2Funit.listening.json'
    );
  });

  it('loads the project for the conversation workspace', async () => {
    show(listeningPagePath('c1', 'listening/unit.listening.json'));
    expect(await screen.findByDisplayValue('中三聆聽')).toBeTruthy();
    expect(conversations.get).toHaveBeenCalledWith('c1');
    expect(transport.request).toHaveBeenCalledWith(
      'GET',
      '/api/edu/audio/listening?conversation_id=c1&path=listening%2Funit.listening.json',
      undefined,
      { sensitive: true }
    );
  });

  it('returns to the conversation', async () => {
    show(listeningPagePath('c1', 'listening/unit.listening.json'));
    await screen.findByDisplayValue('中三聆聽');
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.page.back' }));
    expect(await screen.findByText('chat page')).toBeTruthy();
  });

  it('explains a missing project path', async () => {
    show('/conversation/c1/listening');
    expect(await screen.findByText('messages.listening.page.missing')).toBeTruthy();
  });
});
