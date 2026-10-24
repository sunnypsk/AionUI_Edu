import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const project = {
  version: 1,
  title: '中三聆聽',
  defaults: { voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' },
  lexicon: [],
  sections: [
    {
      id: 'part1',
      plays: 1,
      gapBetweenPlays: 5,
      gapAfter: 3,
      segments: [
        { id: 'a', type: 'speech', text: '第一句' },
        { id: 'b', type: 'speech', text: '第二句' },
        { id: 'c', type: 'pause', seconds: 3 },
      ],
    },
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
  await screen.findByDisplayValue('第一句');
};
const row = (id: string) => document.querySelector(`[data-script-row="${id}"]`) as HTMLElement;
const inspector = () => screen.getByRole('complementary', { name: 'messages.listening.inspector.title' });
const order = () =>
  [...document.querySelectorAll('[data-selected]')].map((node) => node.getAttribute('data-script-row'));

describe('editor layout and selection', () => {
  beforeEach(() => {
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

  it('shows project defaults and the lexicon when nothing is selected', async () => {
    await show();
    expect(within(inspector()).getByLabelText('messages.listening.fields.defaultVoice')).toBeTruthy();
    expect(within(inspector()).getByText('messages.listening.lexicon.title')).toBeTruthy();
  });

  it('selects a script row and summarizes it in the inspector', async () => {
    await show();
    fireEvent.click(row('b'));
    expect(row('b').getAttribute('data-selected')).toBe('true');
    expect(within(inspector()).getByText('messages.listening.types.speech')).toBeTruthy();
  });

  it('extends the selection contiguously with shift-click', async () => {
    await show();
    fireEvent.click(row('a'));
    fireEvent.click(row('c'), { shiftKey: true });
    expect(['a', 'b', 'c'].map((id) => row(id).getAttribute('data-selected'))).toEqual(['true', 'true', 'true']);
    expect(within(inspector()).getByText('messages.listening.inspector.multiple')).toBeTruthy();
  });

  it('keeps the selection across views and edits the selected line in the timeline inspector', async () => {
    await show();
    fireEvent.click(row('b'));
    fireEvent.click(screen.getByText('messages.listening.view.timeline'));
    expect(within(inspector()).getByDisplayValue('第二句')).toBeTruthy();
    fireEvent.click(screen.getByText('messages.listening.view.script'));
    expect(row('b').getAttribute('data-selected')).toBe('true');
  });

  it('inserts a pause after the selected row', async () => {
    await show();
    fireEvent.click(row('a'));
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.insert.pause' }));
    expect(order()).toHaveLength(4);
    expect(order().slice(0, 1)).toEqual(['a']);
    expect(order()[1]).toMatch(/^pause-/);
  });

  it('keeps fields editable while an autosave is in flight', async () => {
    let release: (value: unknown) => void = () => {};
    transport.request.mockImplementation(async (method: string, path: string, body?: { project: unknown }) => {
      if (!String(path).startsWith('/api/edu/audio/listening')) return {};
      if (method === 'PUT')
        return new Promise((resolve) => {
          release = () =>
            resolve({ path, revision: 'r2', project: body!.project, qaThreshold: 0.9, segments: {}, tasks: [] });
        });
      return {
        path: 'listening/unit.listening.json',
        revision: 'r1',
        project,
        qaThreshold: 0.9,
        segments: {},
        tasks: [],
      };
    });
    await show();
    fireEvent.change(screen.getByDisplayValue('第一句'), { target: { value: '第一句。' } });
    await waitFor(() => expect(screen.getByText('messages.listening.save.saving')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByDisplayValue('第一句。')).not.toBeDisabled();
    release(undefined);
    expect(await screen.findByText('messages.listening.save.saved')).toBeTruthy();
  });

  it('inserts at the end of the first section when nothing is selected', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.insert.chime' }));
    expect(order()[3]).toMatch(/^chime-/);
  });
});
