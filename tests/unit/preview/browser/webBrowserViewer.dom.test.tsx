import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserState } from '@/common/types/platform/webRuntime';

const api = vi.hoisted(() => ({ frame: vi.fn(), action: vi.fn(), control: vi.fn() }));
vi.mock('@/renderer/pages/conversation/Preview/browser/WebBrowserViewer/api', () => ({ browserApi: api }));
vi.mock('@/renderer/pages/conversation/explorer/currentConversationStore', () => ({
  useCurrentConversation: () => 'task-one',
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import WebBrowserViewer from '@/renderer/pages/conversation/Preview/browser/WebBrowserViewer';

const state = (overrides: Partial<BrowserState> = {}): BrowserState => ({
  running: false,
  agentEnabled: false,
  control: 'human',
  takingOver: false,
  revision: 1,
  activeTabId: null,
  tabs: [],
  downloads: [],
  viewport: { width: 500, height: 500 },
  ...overrides,
});
const show = (value: BrowserState): void => {
  for (const method of Object.values(api)) method.mockResolvedValue({ state: value });
  render(<WebBrowserViewer visible />);
};

describe('shared browser manual controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      }
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('can reopen an empty browser while agent access is disabled', async () => {
    show(state());
    await screen.findByText('preview.sharedBrowser.startHint');
    const button = screen.getByRole('button', { name: 'preview.sharedBrowser.takeOver' });
    fireEvent.click(button);
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('task-one', { kind: 'open' }));
    expect(api.control).toHaveBeenCalledWith('task-one', 'human');
  });

  it('keeps manual navigation available while preventing return to a disabled agent', async () => {
    show(
      state({
        running: true,
        activeTabId: 'tab-one',
        tabs: [{ id: 'tab-one', title: '', url: 'about:blank', fileChooser: false }],
      })
    );
    const button = await screen.findByRole('button', { name: 'preview.sharedBrowser.returnToAi' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('textbox', { name: 'preview.browser.addressPlaceholder' }).hasAttribute('disabled')).toBe(
      false
    );
  });

  it('prevents manual navigation until the user takes control', async () => {
    show(
      state({
        running: true,
        agentEnabled: true,
        control: 'agent',
        activeTabId: 'tab-one',
        tabs: [{ id: 'tab-one', title: '', url: 'about:blank', fileChooser: false }],
      })
    );
    const input = await screen.findByRole('textbox', { name: 'preview.browser.addressPlaceholder' });
    expect(input.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'preview.sharedBrowser.takeOver' }).hasAttribute('disabled')).toBe(false);
  });
});
