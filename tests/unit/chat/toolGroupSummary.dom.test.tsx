import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IMessageAcpToolCall, IMessageTips } from '@/common/chat/chatLib';
import type { ToolMessage } from '@/common/chat/normalizeToolCall';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';

vi.mock('@/common', () => ({ ipcBridge: { database: { getConversationMessage: { invoke: vi.fn() } } } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`),
  }),
}));

const webSearch = (id: string, query: string) =>
  ({
    id,
    conversation_id: 'c1',
    type: 'acp_tool_call',
    content: {
      sessionId: 's1',
      update: {
        sessionUpdate: 'tool_call',
        tool_call_id: id,
        status: 'completed',
        title: 'webSearch',
        kind: 'fetch',
        raw_input: { action: { query } },
      },
    },
  }) as unknown as IMessageAcpToolCall;

describe('MessageToolGroupSummary header', () => {
  it('is an accessible button that toggles with Enter and shows the localised count', async () => {
    const user = userEvent.setup();
    render(<MessageToolGroupSummary messages={[webSearch('a', '香港天文台 明日天氣'), webSearch('b', 'x')]} />);
    const header = screen.getByRole('button', { name: /messages\.toolSummary\.viewSteps:2/ });
    expect(header.tagName).toBe('BUTTON');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    header.focus();
    await user.keyboard('{Enter}');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByText('messages.toolSummary.names.webSearch')).toHaveLength(2);
    expect(screen.getByText('香港天文台 明日天氣')).toBeTruthy();
    await user.keyboard(' ');
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps unknown tool names raw', () => {
    const msg = webSearch('c', 'q');
    (msg.content as unknown as { update: { title: string } }).update.title = 'mystery';
    render(<MessageToolGroupSummary messages={[msg]} />);
    fireEvent.click(screen.getByRole('button', { name: /viewSteps/ }));
    expect(screen.getByText('mystery')).toBeTruthy();
  });

  it('shows the localised name and query for a Codex tool_call webSearch', () => {
    const input = { type: 'webSearch', query: '', action: { type: 'search', query: '香港天文台 明日天氣' } };
    const msg = {
      id: 'm',
      conversation_id: 'c1',
      type: 'tool_call',
      content: { call_id: 'w', name: 'webSearch', args: input, input, status: 'completed' },
    } as unknown as ToolMessage;
    render(<MessageToolGroupSummary messages={[msg]} />);
    fireEvent.click(screen.getByRole('button', { name: /viewSteps/ }));
    expect(screen.getByText('messages.toolSummary.names.webSearch')).toBeTruthy();
    expect(screen.getByText('香港天文台 明日天氣')).toBeTruthy();
  });
});

describe('technical records within steps', () => {
  const content = 'Automatic approval review approved (risk: low, authorization: high): Wait for task.';
  const notice: IMessageTips = {
    id: 'approval',
    conversation_id: 'c1',
    type: 'tips',
    content: { content, type: 'warning' },
  };

  it('shows a single neutral technical-details control when there are no tool steps', () => {
    render(<MessageToolGroupSummary messages={[]} notices={[notice]} />);
    expect(screen.getByRole('button', { name: /common.technical_details/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /viewSteps/ })).not.toBeInTheDocument();
    expect(screen.queryByText(content)).not.toBeInTheDocument();
  });

  it('keeps technical records closed while a live tool opens its progress', () => {
    const running = webSearch('running', 'q');
    running.content.update.status = 'in_progress';
    const { rerender } = render(<MessageToolGroupSummary messages={[running]} notices={[notice]} />);
    const toggle = screen.getByRole('button', { name: /common.technical_details/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    rerender(<MessageToolGroupSummary messages={[running]} notices={[notice, { ...notice, id: 'next' }]} />);
    expect(screen.queryByText(content)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText(content)).toBeVisible();
  });
});
