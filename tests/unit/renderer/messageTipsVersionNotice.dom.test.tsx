/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IMessageTips, TMessage } from '@/common/chat/chatLib';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isTechnicalTipMessage } from '@/renderer/utils/chat/hiddenTips';

const isElectronDesktop = vi.hoisted(() => vi.fn());

vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));
vi.mock('@renderer/components/Markdown', () => ({ default: () => null }));
vi.mock('@renderer/components/base/ButlerDiagnoseButton', () => ({ default: () => null }));

vi.mock('@renderer/components/chat/CollapsibleContent', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import MessageTips, { MessageTechnicalDetails } from '@/renderer/pages/conversation/Messages/components/MessageTips';

const tip = (code: string): IMessageTips =>
  ({
    id: code,
    type: 'tips',
    position: 'center',
    conversation_id: 'c',
    content: { content: `body for ${code}`, type: 'info', code },
  }) as unknown as IMessageTips;

describe('MessageTips CLI version notices', () => {
  beforeEach(() => isElectronDesktop.mockReset());

  it('hides the newer-than-verified notice in the web runtime', () => {
    isElectronDesktop.mockReturnValue(false);
    const { container } = render(<MessageTips message={tip('CLI_VERSION_NEWER')} />);
    expect(container.firstChild).toBeNull();
  });

  it('keeps the newer-than-verified notice on desktop', () => {
    isElectronDesktop.mockReturnValue(true);
    const { container } = render(<MessageTips message={tip('CLI_VERSION_NEWER')} />);
    expect(container.textContent).toContain('body for CLI_VERSION_NEWER');
  });

  it('keeps the older-than-verified notice in the web runtime', () => {
    isElectronDesktop.mockReturnValue(false);
    const { container } = render(<MessageTips message={tip('CLI_VERSION_OLDER')} />);
    expect(container.textContent).toContain('body for CLI_VERSION_OLDER');
  });
});

const approval = 'Automatic approval review approved (risk: low, authorization: high): Waiting for the audio task.';
const diagnostic = (content: string, extra?: Partial<IMessageTips['content']>): IMessageTips => ({
  ...tip('notice'),
  content: { content, type: 'warning', ...extra },
});

describe('teacher-facing technical notices', () => {
  it.each([
    approval,
    'Full-history hydration is deprecated for paginated threads; use `excludeTurns: true`.',
    'Under-development features enabled: chronicle. Under-development features are incomplete.',
    '`[features].collab` is deprecated. Use `[features].multi_agent` instead.',
  ])('keeps the known notice collapsed until explicitly opened: %s', async (content) => {
    const user = userEvent.setup();
    render(<MessageTips message={diagnostic(content)} />);
    const toggle = screen.getByRole('button', { name: /common.technical_details/ });
    expect(screen.queryByText(content)).not.toBeInTheDocument();
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText(content)).toBeVisible();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([
    'Automatic approval review rejected (risk: high, authorization: low): Needs confirmation.',
    'The audio tools are unavailable. Restart the service.',
    'Unknown warning: the task could not complete.',
  ])('keeps actionable and unknown warnings visible: %s', (content) => {
    render(<MessageTips message={diagnostic(content)} />);
    expect(screen.getByText(content)).toBeVisible();
    expect(screen.queryByRole('button', { name: /common.technical_details/ })).not.toBeInTheDocument();
  });

  it.each([{ type: 'error' as const }, { code: 'ACTION_REQUIRED' }])(
    'does not collapse errors or coded guidance even if their text resembles a known notice',
    (extra) => {
      render(<MessageTips message={diagnostic(approval, extra)} />);
      expect(screen.getByText(approval)).toBeVisible();
      expect(screen.queryByRole('button', { name: /common.technical_details/ })).not.toBeInTheDocument();
    }
  );

  it('leaves matching text in user and assistant messages untouched', () => {
    const text = { ...tip('chat'), type: 'text', content: { content: approval } } as TMessage;
    expect(isTechnicalTipMessage({ ...text, position: 'left' })).toBe(false);
    expect(isTechnicalTipMessage({ ...text, position: 'right' })).toBe(false);
  });

  it('merges identical records while retaining their count and complete original text', () => {
    render(<MessageTechnicalDetails messages={[diagnostic(approval), { ...diagnostic(approval), id: 'repeat' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /common.technical_details · 2/ }));
    expect(screen.getAllByText(approval)).toHaveLength(1);
    expect(screen.getByText('conversation.agentTip.technical.repeated')).toBeVisible();
  });
});
