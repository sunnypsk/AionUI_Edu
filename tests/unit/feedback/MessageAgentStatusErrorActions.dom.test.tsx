/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Verifies MessageAgentStatus offers the Butler diagnosis chip only on
 * 'error' status, with no upstream report action.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts?.agent) return `${k}:${String(opts.agent)}`;
      return k;
    },
    i18n: { language: 'en' },
  }),
}));

import MessageAgentStatus from '@/renderer/pages/conversation/Messages/components/MessageAgentStatus';
import type { IMessageAgentStatus } from '@/common/chat/chatLib';

const buildMessage = (status: IMessageAgentStatus['content']['status']): IMessageAgentStatus =>
  ({
    id: 'm1',
    type: 'agent_status',
    content: {
      backend: 'claude',
      status,
      agent_name: 'Claude',
    },
  }) as IMessageAgentStatus;

const BUTLER_LABEL = 'settings.talkToButler.solveWithButler';

describe('MessageAgentStatus — error actions', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not render the Butler chip on successful statuses', () => {
    render(<MessageAgentStatus message={buildMessage('connected')} />);
    expect(screen.queryByText(BUTLER_LABEL)).not.toBeInTheDocument();
  });

  it('renders the Butler chip but no report action when agent status is error', () => {
    render(<MessageAgentStatus message={buildMessage('error')} />);
    expect(screen.getByText(BUTLER_LABEL)).toBeInTheDocument();
    expect(screen.queryByText('settings.oneClickFeedback')).not.toBeInTheDocument();
  });

  it('falls back to a capitalized backend name without consulting runtime agent catalogs', () => {
    render(
      <MessageAgentStatus
        message={
          {
            id: 'm2',
            type: 'agent_status',
            content: {
              backend: 'codex',
              status: 'connected',
            },
          } as IMessageAgentStatus
        }
      />
    );

    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('acp.status.connected:Codex')).toBeInTheDocument();
  });
});
