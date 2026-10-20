/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Verifies MessageToolGroup offers the Butler diagnosis chip only when a tool
 * call has status='Error', with no upstream report action.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

// Stub heavy dependencies that MessageToolGroup pulls in so this test can
// render in pure jsdom without the whole app tree.
vi.mock('@renderer/components/chat/CollapsibleContent', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@renderer/components/Markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@renderer/components/media/LocalImageView', () => ({
  default: () => null,
}));
vi.mock('@/renderer/components/base/FileChangesPanel', () => ({
  default: () => null,
}));
vi.mock('@/renderer/hooks/file/useDiffPreviewHandlers', () => ({
  useDiffPreviewHandlers: () => ({ openDiff: () => {}, openFile: () => {} }),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { respondToConfirmation: { invoke: vi.fn() } },
    conversation: { respondToConfirmation: { invoke: vi.fn() } },
  },
}));

import MessageToolGroup from '@/renderer/pages/conversation/Messages/components/MessageToolGroup';
import type { IMessageToolGroup } from '@/common/chat/chatLib';

const buildToolGroup = (status: IMessageToolGroup['content'][number]['status']): IMessageToolGroup =>
  ({
    id: 'tg-1',
    type: 'tool_group',
    content: [
      {
        call_id: 'c1',
        description: 'ran something',
        name: 'Read',
        render_output_as_markdown: false,
        status,
        result_display: 'ENOENT: no such file',
      },
    ],
  }) as IMessageToolGroup;

const BUTLER_LABEL = 'settings.talkToButler.solveWithButler';

describe('MessageToolGroup — error actions', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not render the Butler chip on successful tool calls', () => {
    render(<MessageToolGroup message={buildToolGroup('Success')} />);
    expect(screen.queryByText(BUTLER_LABEL)).not.toBeInTheDocument();
  });

  it('does not render the Butler chip on canceled tool calls', () => {
    render(<MessageToolGroup message={buildToolGroup('Canceled')} />);
    expect(screen.queryByText(BUTLER_LABEL)).not.toBeInTheDocument();
  });

  it('renders the Butler chip but no report action when status=Error', () => {
    render(<MessageToolGroup message={buildToolGroup('Error')} />);
    expect(screen.getByText(BUTLER_LABEL)).toBeInTheDocument();
    expect(screen.queryByText('settings.oneClickFeedback')).not.toBeInTheDocument();
  });
});
