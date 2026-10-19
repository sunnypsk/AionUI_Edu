import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IMessageAcpToolCall } from '@/common/chat/chatLib';
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
  it('is an accessible button that toggles with Enter and shows the localised count', () => {
    render(<MessageToolGroupSummary messages={[webSearch('a', '香港天文台 明日天氣'), webSearch('b', 'x')]} />);
    const header = screen.getByRole('button', { name: /messages\.toolSummary\.viewSteps:2/ });
    expect(header.getAttribute('tabindex')).toBe('0');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByText('messages.toolSummary.names.webSearch')).toHaveLength(2);
    expect(screen.getByText('香港天文台 明日天氣')).toBeTruthy();
    fireEvent.keyDown(header, { key: ' ' });
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps unknown tool names raw', () => {
    const msg = webSearch('c', 'q');
    (msg.content as unknown as { update: { title: string } }).update.title = 'mystery';
    render(<MessageToolGroupSummary messages={[msg]} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /viewSteps/ }), { key: 'Enter' });
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
    fireEvent.keyDown(screen.getByRole('button', { name: /viewSteps/ }), { key: 'Enter' });
    expect(screen.getByText('messages.toolSummary.names.webSearch')).toBeTruthy();
    expect(screen.getByText('香港天文台 明日天氣')).toBeTruthy();
  });
});
