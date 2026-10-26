/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IMessageAcpToolCall,
  IMessageText,
  IMessageTips,
  IMessageToolGroup,
  TMessage,
} from '@/common/chat/chatLib';
import type { MessageFileChangesProps } from '@/renderer/pages/conversation/Messages/MessageFileChanges';
import {
  MessageListLoadingProvider,
  MessageListProvider,
  MessagePaginationProvider,
  type MessagePaginationState,
  useUpdateMessageList,
} from '@/renderer/pages/conversation/Messages/hooks';
import MessageList, { interleaveArtifacts } from '@/renderer/pages/conversation/Messages/MessageList';

const { parseDiffMock, useTeamPermissionMock, toolSummaryRender, loadMessagePageMock, loadAnchorWindowMock } =
  vi.hoisted(() => ({
    parseDiffMock: vi.fn(),
    useTeamPermissionMock: vi.fn(),
    toolSummaryRender: vi.fn(),
    loadMessagePageMock: vi.fn(),
    loadAnchorWindowMock: vi.fn(),
  }));

vi.mock('@/renderer/utils/chat/messagePagination', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/utils/chat/messagePagination')>()),
  loadConversationMessagePage: loadMessagePageMock,
  loadConversationAnchorWindow: loadAnchorWindowMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

let mockTargetMessageId: string | undefined;
vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    key: 'location-key',
    state: { targetMessageId: mockTargetMessageId },
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Image: {
    PreviewGroup: ({ children }: PropsWithChildren) => <>{children}</>,
  },
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({ conversation_id: 'conversation-1', type: 'aionrs' }),
}));

vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: useTeamPermissionMock,
}));

vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => false }));

let mockIsProcessing = false;
vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => ({ isProcessing: mockIsProcessing }),
}));

vi.mock('@/renderer/pages/conversation/Messages/artifacts', () => ({
  useConversationArtifacts: () => [],
}));

vi.mock('@/renderer/pages/conversation/Messages/useAutoScroll', () => ({
  useAutoScroll: () => ({
    handleScrollerRef: () => {},
    handleContentRef: () => {},
    handleScroll: () => {},
    handleWheel: () => {},
    handlePointerDown: () => {},
    showScrollButton: false,
    scrollToBottom: () => {},
    scrollElementIntoView: () => {},
    hideScrollButton: () => {},
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageText', () => ({
  default: ({ message, showCopyRow }: { message: IMessageText; showCopyRow?: boolean }) => (
    <div data-testid={`msgtext-${message.id}`} data-copy-row={String(showCopyRow ?? true)}>
      {message.content.content}
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageTips', () => ({
  default: ({ message, recovered }: { message: { id: string }; recovered?: boolean }) => (
    <div data-testid={`tips-${message.id}`} data-recovered={String(Boolean(recovered))}>
      tips
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolCall', () => ({
  default: () => <div>tool_call</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroup', () => ({
  default: ({ message }: { message: IMessageToolGroup }) => (
    <div data-testid='tool-group' data-message-id={message.id}>
      tool_group
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageAgentStatus', () => ({
  default: () => <div>agent_status</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessagePermission', () => ({
  default: () => <div>permission</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpPermission', () => ({
  default: () => <div>acp_permission</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpToolCall', () => ({
  default: ({ message }: { message: IMessageAcpToolCall }) => (
    <div
      data-testid='acp-tool-call'
      data-message-id={message.id}
      data-diff-count={message.content.update.content?.filter((item) => item.type === 'diff').length ?? 0}
    >
      acp_tool_call
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageThinking', () => ({
  default: () => <div>thinking</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageCronTrigger', () => ({
  default: () => <div>cron_trigger</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageSkillSuggest', () => ({
  default: () => <div>skill_suggest</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary', () => ({
  default: React.memo(
    ({ messages, notices }: { messages: Array<IMessageToolGroup | IMessageAcpToolCall>; notices?: IMessageTips[] }) => {
      toolSummaryRender(messages);
      return (
        <div data-testid='tool-summary' data-notice-ids={notices?.map((message) => message.id).join(',')}>
          {messages.map((message) => message.id).join(',')}
        </div>
      );
    }
  ),
}));

vi.mock('@/renderer/pages/conversation/Messages/MessageFileChanges', () => ({
  __esModule: true,
  default: ({ diffsChanges }: MessageFileChangesProps) => (
    <div data-testid='file-changes' data-file-count={diffsChanges?.length ?? 0}>
      file_changes
    </div>
  ),
  parseDiff: parseDiffMock,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/SelectionReplyButton', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/conversation/Messages/anchorRail', () => ({
  MessageAnchorRail: () => null,
}));

vi.mock('@icon-park/react', () => ({
  Down: () => <span>down</span>,
}));

function createTextMessage(): IMessageText {
  return {
    id: 'message-1',
    msg_id: 'msg-1',
    conversation_id: 'conversation-1',
    type: 'text',
    position: 'left',
    content: {
      content: 'streaming reply',
    },
    created_at: 1,
  };
}

type AcpToolCallOptions = {
  id?: string;
  status?: IMessageAcpToolCall['content']['update']['status'];
  content?: IMessageAcpToolCall['content']['update']['content'];
  truncated?: boolean;
};

function createAcpToolCall({
  id = 'acp-edit-1',
  status = 'completed',
  content,
  truncated = false,
}: AcpToolCallOptions = {}): IMessageAcpToolCall {
  return {
    id,
    msg_id: id,
    conversation_id: 'conversation-1',
    type: 'acp_tool_call',
    position: 'left',
    content: {
      session_id: 'session-1',
      ...(truncated
        ? {
            _compact: {
              truncated: true,
              original_size: 90000,
              preview_chars: 4096,
            },
          }
        : {}),
      update: {
        sessionUpdate: 'tool_call_update',
        tool_call_id: id,
        status,
        title: 'Edit file',
        kind: 'edit',
        content,
      },
    },
    created_at: 2,
  } as IMessageAcpToolCall;
}

function createToolGroup(content: IMessageToolGroup['content'], id = 'tool-group-1'): IMessageToolGroup {
  return {
    id,
    msg_id: id,
    conversation_id: 'conversation-1',
    type: 'tool_group',
    position: 'left',
    content,
    created_at: 2,
  };
}

function Wrapper({
  children,
  messages = [createTextMessage()],
  loading = false,
  pagination = { hasMoreBefore: false, hasMoreAfter: false, isLoadingBefore: false, isLoadingAnchor: false },
}: PropsWithChildren<{
  messages?: TMessage[];
  loading?: boolean;
  pagination?: MessagePaginationState;
}>): JSX.Element {
  return (
    <MessageListLoadingProvider value={loading}>
      <MessagePaginationProvider value={pagination}>
        <MessageListProvider value={messages}>{children}</MessageListProvider>
      </MessagePaginationProvider>
    </MessageListLoadingProvider>
  );
}

function ReplaceMessagesButton({ messages }: { messages: TMessage[] }): JSX.Element {
  const updateMessages = useUpdateMessageList();
  return <button onClick={() => updateMessages(messages)}>replace messages</button>;
}

const createApprovalTip = (id: string): IMessageTips => ({
  id,
  msg_id: id,
  conversation_id: 'conversation-1',
  type: 'tips',
  position: 'center',
  content: {
    content: 'Automatic approval review approved (risk: low, authorization: high): Wait for the task.',
    type: 'warning',
  },
});

describe('MessageList', () => {
  beforeEach(() => {
    mockTargetMessageId = undefined;
    mockIsProcessing = false;
    toolSummaryRender.mockClear();
    parseDiffMock.mockReset();
    parseDiffMock.mockReturnValue({
      file_name: 'file.ts',
      fullPath: '/workspace/file.ts',
      insertions: 1,
      deletions: 1,
      diff: 'diff',
    });
    useTeamPermissionMock.mockReturnValue(null);
  });

  describe('history pagination', () => {
    let clientHeight: number;
    let scrollHeight: number;
    let contentHeight: number;
    const resizeCallbacks = new Set<() => void>();

    const notifyResize = () => {
      act(() => {
        for (const callback of Array.from(resizeCallbacks)) callback();
      });
    };

    const renderPagedList = (pagination: Partial<MessagePaginationState> = {}) =>
      render(<MessageList />, {
        wrapper: ({ children }) => (
          <Wrapper
            messages={[createAcpToolCall({ id: 'latest-tool' })]}
            pagination={{
              oldestCursor: 'latest-page',
              hasMoreBefore: true,
              hasMoreAfter: false,
              isLoadingBefore: false,
              isLoadingAnchor: false,
              ...pagination,
            }}
          >
            {children}
          </Wrapper>
        ),
      });

    beforeEach(() => {
      clientHeight = 632;
      scrollHeight = 632;
      contentHeight = 100;
      loadMessagePageMock.mockReset();
      loadAnchorWindowMock.mockReset();
      resizeCallbacks.clear();
      vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
        return this.getAttribute('data-testid') === 'message-list-scroller' ? clientHeight : 0;
      });
      vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
        if (this.getAttribute('data-testid') === 'message-list-content') return contentHeight;
        return this.getAttribute('data-testid') === 'message-list-scroller' ? scrollHeight : 0;
      });
      vi.stubGlobal(
        'ResizeObserver',
        class implements ResizeObserver {
          private readonly notify: () => void;

          constructor(callback: ResizeObserverCallback) {
            this.notify = () => callback([], this);
            resizeCallbacks.add(this.notify);
          }

          observe() {}
          unobserve() {}
          disconnect() {
            resizeCallbacks.delete(this.notify);
          }
        }
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('loads earlier pages until collapsed tool history has enough content to scroll', async () => {
      loadMessagePageMock
        .mockResolvedValueOnce({
          items: [createAcpToolCall({ id: 'earlier-tool' })],
          oldest_cursor: 'earlier-page',
          has_more_before: true,
        })
        .mockImplementationOnce(async () => {
          scrollHeight = 900;
          return {
            items: [createTextMessage()],
            oldest_cursor: 'oldest-page',
            has_more_before: true,
          };
        });

      renderPagedList();

      expect(await screen.findByText('streaming reply')).toBeInTheDocument();
      expect(loadMessagePageMock.mock.calls.map(([, options]) => options.before)).toEqual([
        'latest-page',
        'earlier-page',
      ]);
    });

    it('stops at the beginning of history even when the content still fits', async () => {
      loadMessagePageMock.mockResolvedValue({ items: [createTextMessage()], has_more_before: false });
      renderPagedList();

      expect(await screen.findByText('streaming reply')).toBeInTheDocument();
      notifyResize();
      expect(loadMessagePageMock).toHaveBeenCalledTimes(1);
    });

    it('preserves the visible content when auto-filling prepends a taller history page', async () => {
      loadMessagePageMock.mockImplementationOnce(async () => {
        contentHeight = 900;
        scrollHeight = 900;
        return { items: [createTextMessage()], has_more_before: false };
      });
      renderPagedList();
      await waitFor(() => expect(screen.getByTestId('message-list-scroller').scrollTop).toBe(800));
      expect(loadMessagePageMock).toHaveBeenCalledTimes(1);
    });

    it('loads earlier messages when resizing or collapsing content removes the scroll range', async () => {
      scrollHeight = 900;
      loadMessagePageMock.mockResolvedValue({ items: [createTextMessage()], has_more_before: false });
      renderPagedList();
      expect(loadMessagePageMock).not.toHaveBeenCalled();

      scrollHeight = 632;
      notifyResize();

      expect(await screen.findByText('streaming reply')).toBeInTheDocument();
      expect(loadMessagePageMock).toHaveBeenCalledTimes(1);
    });

    it.each([{ isLoadingBefore: true }, { isLoadingAnchor: true }])(
      'waits for an existing history request: %j',
      (pagination) => {
        renderPagedList(pagination);
        notifyResize();
        expect(loadMessagePageMock).not.toHaveBeenCalled();
      }
    );

    it('does not load history while the conversation is hidden', () => {
      clientHeight = 0;
      renderPagedList();
      notifyResize();
      expect(loadMessagePageMock).not.toHaveBeenCalled();
    });

    it('lets search load its target window before filling the viewport', () => {
      mockTargetMessageId = 'searched-message';
      loadAnchorWindowMock.mockReturnValue(new Promise(() => {}));
      renderPagedList();
      notifyResize();

      expect(loadAnchorWindowMock).toHaveBeenCalledTimes(1);
      expect(loadMessagePageMock).not.toHaveBeenCalled();
    });

    it('avoids automatic retries after a failed page while allowing a manual retry', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      loadMessagePageMock
        .mockRejectedValueOnce(new Error('History request failed'))
        .mockResolvedValueOnce({ items: [createTextMessage()], has_more_before: false });
      renderPagedList();

      await waitFor(() => expect(consoleError).toHaveBeenCalled());
      notifyResize();
      notifyResize();
      expect(loadMessagePageMock).toHaveBeenCalledTimes(1);

      fireEvent.wheel(screen.getByTestId('message-list-scroller'), { deltaY: -120 });
      expect(await screen.findByText('streaming reply')).toBeInTheDocument();
    });
  });

  it('groups persisted approval successes with the surrounding tool steps without blank warning rows', () => {
    const read = createAcpToolCall({ id: 'read' });
    const wait = createAcpToolCall({ id: 'wait' });
    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[read, createApprovalTip('approved'), wait]}>{children}</Wrapper>,
    });
    expect(screen.getAllByTestId('tool-summary')).toHaveLength(1);
    expect(screen.getByTestId('tool-summary')).toHaveAttribute('data-notice-ids', 'approved');
    expect(screen.queryByTestId('message-tips-center')).not.toBeInTheDocument();
  });

  it('applies the same grouping when a later approval arrives in the live list', () => {
    const read = createAcpToolCall({ id: 'read' });
    render(
      <>
        <MessageList />
        <ReplaceMessagesButton messages={[read, createApprovalTip('live-approval')]} />
      </>,
      { wrapper: ({ children }) => <Wrapper messages={[read]}>{children}</Wrapper> }
    );
    fireEvent.click(screen.getByText('replace messages'));
    expect(screen.getAllByTestId('tool-summary')).toHaveLength(1);
    expect(screen.getByTestId('tool-summary')).toHaveAttribute('data-notice-ids', 'live-approval');
  });

  it('keeps a rejected approval as a visible warning that separates tool groups', () => {
    const rejected = createApprovalTip('rejected');
    rejected.content.content =
      'Automatic approval review rejected (risk: high, authorization: low): Requires approval.';
    render(<MessageList />, {
      wrapper: ({ children }) => (
        <Wrapper messages={[createAcpToolCall({ id: 'a' }), rejected, createAcpToolCall({ id: 'b' })]}>
          {children}
        </Wrapper>
      ),
    });
    expect(screen.getByTestId('tips-rejected')).toBeInTheDocument();
    expect(screen.getAllByTestId('tool-summary')).toHaveLength(2);
  });

  it('does not mistake a technical-only group for recovered connection output', () => {
    const retry: IMessageTips = {
      ...createApprovalTip('retry'),
      content: { type: 'warning', code: 'CODEX_RETRYING', content: 'Reconnecting' },
    };
    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[retry, createApprovalTip('approval-only')]}>{children}</Wrapper>,
    });
    expect(screen.getByTestId('tips-retry')).toHaveAttribute('data-recovered', 'false');
  });

  it('updates the connection summary when actual output follows technical-only notices', () => {
    const retry: IMessageTips = {
      ...createApprovalTip('retry'),
      content: { type: 'warning', code: 'CODEX_RETRYING', content: 'Reconnecting' },
    };
    const initial = [retry, createApprovalTip('approval-only')];
    render(
      <>
        <MessageList />
        <ReplaceMessagesButton messages={[...initial, createTextMessage()]} />
      </>,
      { wrapper: ({ children }) => <Wrapper messages={initial}>{children}</Wrapper> }
    );
    expect(screen.getByTestId('tips-retry')).toHaveAttribute('data-recovered', 'false');
    fireEvent.click(screen.getByText('replace messages'));
    expect(screen.getByTestId('tips-retry')).toHaveAttribute('data-recovered', 'true');
  });

  it('does not re-render unchanged tool summaries while another message streams', () => {
    const tool = createAcpToolCall({ id: 'read-1' });
    const text = createTextMessage();
    render(
      <>
        <MessageList />
        <ReplaceMessagesButton messages={[tool, { ...text, content: { content: 'streamed text' } }]} />
      </>,
      {
        wrapper: ({ children }) => <Wrapper messages={[tool, text]}>{children}</Wrapper>,
      }
    );
    toolSummaryRender.mockClear();

    fireEvent.click(screen.getByText('replace messages'));

    expect(screen.getByText('streamed text')).toBeInTheDocument();
    expect(toolSummaryRender).not.toHaveBeenCalled();
  });

  it('updates a changed tool group without re-rendering an unchanged earlier group', () => {
    const earlier = createAcpToolCall({ id: 'read-1' });
    const text = createTextMessage();
    const active = createAcpToolCall({ id: 'read-2', status: 'in_progress' });
    const failed = createAcpToolCall({ id: 'read-2', status: 'failed' });
    render(
      <>
        <MessageList />
        <ReplaceMessagesButton messages={[earlier, text, failed]} />
      </>,
      {
        wrapper: ({ children }) => <Wrapper messages={[earlier, text, active]}>{children}</Wrapper>,
      }
    );
    toolSummaryRender.mockClear();

    fireEvent.click(screen.getByText('replace messages'));

    expect(toolSummaryRender).toHaveBeenCalledTimes(1);
    expect(toolSummaryRender).toHaveBeenCalledWith([failed]);
  });

  it('updates summary membership when a tool is appended or removed', () => {
    const first = createAcpToolCall({ id: 'read-1' });
    const second = createAcpToolCall({ id: 'read-2' });
    const { rerender } = render(
      <>
        <MessageList />
        <ReplaceMessagesButton messages={[first, second]} />
      </>,
      {
        wrapper: ({ children }) => <Wrapper messages={[first]}>{children}</Wrapper>,
      }
    );

    fireEvent.click(screen.getByText('replace messages'));
    expect(screen.getByTestId('tool-summary')).toHaveTextContent('read-1,read-2');
    rerender(
      <>
        <MessageList />
        <ReplaceMessagesButton messages={[second]} />
      </>
    );
    fireEvent.click(screen.getByText('replace messages'));
    expect(screen.getByTestId('tool-summary')).toHaveTextContent('read-2');
    expect(screen.getByTestId('tool-summary')).not.toHaveTextContent('read-1');
  });

  it('never renders a plan as a stream row (it belongs to ConversationPlanBar)', () => {
    // A plan is a replaceable snapshot pinned above the send box, not a message.
    // Filtered rather than rendered as null: a null row still occupies a slot.
    render(
      <>
        <MessageList />
        <ReplaceMessagesButton
          messages={[
            {
              id: 'text-before',
              msg_id: 'turn-a',
              conversation_id: 'conversation-1',
              type: 'text',
              position: 'left',
              created_at: 1,
              content: { content: 'before the plan' },
            } as TMessage,
            {
              id: 'plan:turn-a',
              msg_id: 'turn-a',
              conversation_id: 'conversation-1',
              type: 'plan',
              position: 'left',
              created_at: 2,
              content: { entries: [{ content: 'PLAN_ENTRY_MARKER', status: 'pending' }] },
            } as TMessage,
            {
              id: 'text-after',
              msg_id: 'turn-b',
              conversation_id: 'conversation-1',
              type: 'text',
              position: 'left',
              created_at: 3,
              content: { content: 'after the plan' },
            } as TMessage,
          ]}
        />
      </>,
      { wrapper: ({ children }) => <Wrapper>{children}</Wrapper> }
    );

    fireEvent.click(screen.getByText('replace messages'));

    // Assert on the ROW, not on rendered entry text: this file stubs the message
    // components, so entry text would be absent either way and the test would
    // pass against the unfixed code.
    const content = screen.getByTestId('message-list-content');
    expect(content.querySelectorAll('[data-message-type="plan"]')).toHaveLength(0);
    expect(content.querySelectorAll('[data-message-type="text"]')).toHaveLength(2);
    expect(screen.getByText('before the plan')).toBeInTheDocument();
    expect(screen.getByText('after the plan')).toBeInTheDocument();
  });

  it('drops the hidden web-only version tip instead of leaving a blank row', () => {
    const tip = (id: string, code: string): TMessage =>
      ({
        id,
        msg_id: id,
        conversation_id: 'conversation-1',
        type: 'tips',
        position: 'center',
        created_at: 1,
        content: { content: 'version notice', type: 'info', code },
      }) as TMessage;
    render(
      <>
        <MessageList />
        <ReplaceMessagesButton messages={[tip('newer', 'CLI_VERSION_NEWER'), tip('older', 'CLI_VERSION_OLDER')]} />
      </>,
      { wrapper: ({ children }) => <Wrapper>{children}</Wrapper> }
    );
    fireEvent.click(screen.getByText('replace messages'));

    const tipRows = screen.getByTestId('message-list-content').querySelectorAll('[data-message-type="tips"]');
    expect(tipRows).toHaveLength(1);
  });

  it('renders message rows with external margin spacing in the plain scroll list', () => {
    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper>{children}</Wrapper>,
    });

    expect(screen.getByTestId('message-list-scroller')).toBeInTheDocument();
    expect(screen.getByTestId('message-list-content')).toBeInTheDocument();

    const messageRow = screen.getByTestId('message-text-left');
    expect(messageRow.className).toContain('m-t-10px');
    expect(messageRow.className).not.toContain('pt-10px');
  });

  it('uses container-responsive fluid width for standalone message rows', () => {
    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper>{children}</Wrapper>,
    });

    const messageRow = screen.getByTestId('message-text-left');
    expect(messageRow.className).toContain('chat-surface-fluid');
    expect(messageRow.className).not.toContain('w-[calc(100%-24px)]');
    expect(messageRow.className).not.toContain('md:w-[calc(100%-clamp(80px,10vw,240px))]');
    expect(messageRow.className).not.toContain('max-w-780px');
  });

  it('uses the same container-responsive width in team mode', () => {
    // Team and standalone rows share one class. Width is decided by the column the
    // rows are given, not by the mode: `.chat-surface-fluid` is full-width until
    // its container passes the gutter threshold. A team parallel column (~400px)
    // therefore still renders full width, while team single view — which fills the
    // chat area — gets the same gutters as a standalone conversation, leaving room
    // for the anchor rail instead of crowding the text.
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conversation-1',
      allConversationIds: ['conversation-1'],
      propagateMode: vi.fn(),
      warmupSession: vi.fn().mockResolvedValue(undefined),
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper>{children}</Wrapper>,
    });

    const messageRow = screen.getByTestId('message-text-left');
    expect(messageRow.className).toContain('chat-surface-fluid');
    // No hardcoded viewport-based widths: the container query owns the breakpoint.
    expect(messageRow.className).not.toContain('w-[calc(100%-24px)]');
    expect(messageRow.className).not.toContain('md:w-[calc(100%-clamp(80px,10vw,240px))]');
  });

  it('shows the copy row only on the last AI text of each turn', () => {
    // Turn 1: thinking + text(a) + tool + text(b) -> row only on text(b).
    // A user message ends the turn. Turn 2: text(c) -> row on text(c).
    const messages = [
      { id: 'think-1', type: 'thinking', position: 'left', content: { content: 'thinking' }, created_at: 1 },
      { id: 'text-a', type: 'text', position: 'left', content: { content: 'a' }, created_at: 2 },
      { id: 'tool-1', type: 'tool_call', position: 'left', content: { content: 't' }, created_at: 3 },
      { id: 'text-b', type: 'text', position: 'left', content: { content: 'b' }, created_at: 4 },
      { id: 'user-1', type: 'text', position: 'right', content: { content: 'q' }, created_at: 5 },
      { id: 'text-c', type: 'text', position: 'left', content: { content: 'c' }, created_at: 6 },
    ] as unknown as IMessageText[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    // Intermediate AI text (followed by a tool then another text) hides the row.
    expect(screen.getByTestId('msgtext-text-a').getAttribute('data-copy-row')).toBe('false');
    // Last AI text of turn 1 (after the tool block) keeps the row — fallback strategy.
    expect(screen.getByTestId('msgtext-text-b').getAttribute('data-copy-row')).toBe('true');
    // User message always keeps its own row.
    expect(screen.getByTestId('msgtext-user-1').getAttribute('data-copy-row')).toBe('true');
    // Turn 2's only/last text keeps the row.
    expect(screen.getByTestId('msgtext-text-c').getAttribute('data-copy-row')).toBe('true');
  });

  it('withholds the streaming turn copy row but keeps earlier finished turns', () => {
    mockIsProcessing = true;
    // Turn 1 finished (text-a), then a user message, then turn 2 still streaming (text-b).
    const messages = [
      { id: 'text-a', type: 'text', position: 'left', content: { content: 'a' }, created_at: 1 },
      { id: 'user-1', type: 'text', position: 'right', content: { content: 'q' }, created_at: 2 },
      { id: 'text-b', type: 'text', position: 'left', content: { content: 'b' }, created_at: 3 },
    ] as unknown as IMessageText[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    // Earlier finished turn keeps its row even while a later turn streams.
    expect(screen.getByTestId('msgtext-text-a').getAttribute('data-copy-row')).toBe('true');
    // The in-progress final turn withholds its row until streaming ends.
    expect(screen.getByTestId('msgtext-text-b').getAttribute('data-copy-row')).toBe('false');
  });

  it('keeps a streaming reply below its user message when the browser clock lags the server', () => {
    mockIsProcessing = true;
    // The user row carries the server's time; the live reply is stamped by a browser clock 7s behind.
    const messages = [
      { id: 'text-a', type: 'text', position: 'left', content: { content: 'a' }, created_at: 900 },
      { id: 'user-1', type: 'text', position: 'right', content: { content: 'q' }, created_at: 1000 },
      { id: 'text-b', type: 'text', position: 'left', content: { content: 'b' }, created_at: 993 },
    ] as unknown as IMessageText[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    const user = screen.getByTestId('msgtext-user-1');
    expect(user.compareDocumentPosition(screen.getByTestId('msgtext-text-b'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('slots artifacts between messages by time without reordering the messages', () => {
    const message = (id: string, created_at: number) => ({ id, type: 'text', created_at }) as unknown as IMessageText;
    const artifact = (id: string, created_at: number) =>
      ({ type: 'artifact', id, created_at, artifact: {} }) as Parameters<typeof interleaveArtifacts>[1][number];
    const ordered = interleaveArtifacts(
      [message('a', 10), message('user', 30), message('live', 25)],
      [artifact('late', 40), artifact('early', 20)]
    );
    expect(ordered.map((item) => item.id)).toEqual(['a', 'early', 'user', 'live', 'late']);
  });

  it('marks a tip as recovered only when real output follows it', () => {
    const messages = [
      { id: 'retry', type: 'tips', position: 'center', content: { content: 'r', type: 'warning' }, created_at: 1 },
      { id: 'text-a', type: 'text', position: 'left', content: { content: 'a' }, created_at: 2 },
      { id: 'late-retry', type: 'tips', position: 'center', content: { content: 'r', type: 'warning' }, created_at: 3 },
      { id: 'failed', type: 'tips', position: 'center', content: { content: 'f', type: 'error' }, created_at: 4 },
    ] as unknown as IMessageText[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('tips-retry')).toHaveAttribute('data-recovered', 'true');
    expect(screen.getByTestId('tips-late-retry')).toHaveAttribute('data-recovered', 'false');
    expect(screen.getByTestId('tips-failed')).toHaveAttribute('data-recovered', 'false');
  });

  it('renders the empty slot when there are no messages', () => {
    render(<MessageList emptySlot={<div>empty state</div>} />, {
      wrapper: ({ children }) => <Wrapper messages={[]}>{children}</Wrapper>,
    });

    expect(screen.getByText('empty state')).toBeInTheDocument();
  });

  it('renders a skeleton while the initial message batch is loading', () => {
    render(<MessageList emptySlot={<div>empty state</div>} />, {
      wrapper: ({ children }) => (
        <Wrapper messages={[]} loading>
          {children}
        </Wrapper>
      ),
    });

    expect(screen.getByTestId('message-list-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('empty state')).not.toBeInTheDocument();
  });

  it('renders complete ACP diffs through the specialized file-change message', () => {
    const message = createAcpToolCall({
      content: [
        { type: 'content', content: { type: 'text', text: 'updated both files' } },
        { type: 'diff', path: '/workspace/a.ts', old_text: 'old a', new_text: 'new a' },
        { type: 'diff', path: '/workspace/b.ts', old_text: 'old b', new_text: 'new b' },
      ],
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('acp-tool-call')).toHaveAttribute('data-diff-count', '2');
    expect(screen.queryByTestId('tool-summary')).not.toBeInTheDocument();
  });

  it('renders a newly created file when only new text is present', () => {
    const message = createAcpToolCall({
      content: [{ type: 'diff', path: '/workspace/new-file.ts', new_text: 'export const created = true;' }],
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('acp-tool-call')).toHaveAttribute('data-diff-count', '1');
    expect(screen.queryByTestId('tool-summary')).not.toBeInTheDocument();
  });

  it('keeps ACP calls without diffs in View Steps', () => {
    const message = createAcpToolCall({
      id: 'acp-read-1',
      content: [{ type: 'content', content: { type: 'text', text: 'file contents' } }],
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('tool-summary')).toHaveTextContent('acp-read-1');
    expect(screen.queryByTestId('acp-tool-call')).not.toBeInTheDocument();
  });

  it('keeps malformed ACP diffs in View Steps instead of showing misleading stats', () => {
    const message = createAcpToolCall({
      content: [
        { type: 'diff', path: '/workspace/valid.ts', old_text: 'old', new_text: 'new' },
        null,
        { type: 'diff', new_text: 'missing path' },
      ] as unknown as IMessageAcpToolCall['content']['update']['content'],
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('tool-summary')).toHaveTextContent(message.id);
    expect(screen.queryByTestId('acp-tool-call')).not.toBeInTheDocument();
  });

  it('keeps an ACP message without an update in View Steps', () => {
    const message = {
      ...createAcpToolCall({ id: 'acp-missing-update' }),
      content: { session_id: 'session-1' },
    } as unknown as IMessageAcpToolCall;

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('tool-summary')).toHaveTextContent(message.id);
    expect(screen.queryByTestId('acp-tool-call')).not.toBeInTheDocument();
  });

  it('keeps truncated ACP diffs in View Steps instead of calculating stats from the preview', () => {
    const message = createAcpToolCall({
      truncated: true,
      content: [{ type: 'diff', path: '/workspace/file.ts', old_text: 'partial old', new_text: 'partial new' }],
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('tool-summary')).toHaveTextContent(message.id);
    expect(screen.queryByTestId('acp-tool-call')).not.toBeInTheDocument();
  });

  it('switches a running tool from View Steps when its completed update adds a diff', () => {
    const runningMessage = createAcpToolCall({ status: 'in_progress' });
    const completedMessage = createAcpToolCall({
      content: [{ type: 'diff', path: '/workspace/file.ts', old_text: 'old', new_text: 'new' }],
    });
    render(
      <Wrapper messages={[runningMessage]}>
        <MessageList />
        <ReplaceMessagesButton messages={[completedMessage]} />
      </Wrapper>
    );

    expect(screen.getByTestId('tool-summary')).toHaveTextContent(runningMessage.id);

    fireEvent.click(screen.getByText('replace messages'));

    expect(screen.getByTestId('acp-tool-call')).toHaveAttribute('data-message-id', completedMessage.id);
    expect(screen.queryByTestId('tool-summary')).not.toBeInTheDocument();
  });

  it('preserves surrounding tool summaries when an ACP edit contains multiple diffs', () => {
    const readMessage = createAcpToolCall({ id: 'acp-read-1' });
    const editMessage = createAcpToolCall({
      id: 'acp-edit-1',
      content: [
        { type: 'diff', path: '/workspace/a.ts', old_text: 'old a', new_text: 'new a' },
        { type: 'diff', path: '/workspace/b.ts', old_text: 'old b', new_text: 'new b' },
      ],
    });
    const executeMessage = createAcpToolCall({ id: 'acp-execute-1' });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[readMessage, editMessage, executeMessage]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('acp-tool-call')).toHaveAttribute('data-diff-count', '2');
    expect(screen.getAllByTestId('tool-summary')).toHaveLength(2);
    expect(screen.getAllByTestId('tool-summary').map((item) => item.textContent)).toEqual([
      'acp-read-1',
      'acp-execute-1',
    ]);
  });

  it('preserves the legacy single WriteFile summary path', () => {
    const message = createToolGroup([
      {
        call_id: 'write-1',
        description: 'Write file',
        name: 'WriteFile',
        render_output_as_markdown: false,
        result_display: {
          file_diff: 'diff --git a/file.ts b/file.ts\n-old\n+new',
          file_name: '/workspace/file.ts',
        },
        status: 'Success',
      },
    ]);

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('file-changes')).toHaveAttribute('data-file-count', '1');
    expect(parseDiffMock).toHaveBeenCalledWith('diff --git a/file.ts b/file.ts\n-old\n+new', '/workspace/file.ts');
    expect(screen.queryByTestId('tool-summary')).not.toBeInTheDocument();
  });

  it('aggregates legacy groups containing only structured WriteFile results', () => {
    const message = createToolGroup([
      {
        call_id: 'write-1',
        description: 'Write file',
        name: 'WriteFile',
        render_output_as_markdown: false,
        result_display: {
          file_diff: 'diff --git a/file.ts b/file.ts\n-old\n+new',
          file_name: '/workspace/file.ts',
        },
        status: 'Success',
      },
      {
        call_id: 'write-2',
        description: 'Write second file',
        name: 'WriteFile',
        render_output_as_markdown: false,
        result_display: {
          file_diff: 'diff --git a/second.ts b/second.ts\n-old\n+new',
          file_name: '/workspace/second.ts',
        },
        status: 'Success',
      },
    ]);

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('file-changes')).toHaveAttribute('data-file-count', '2');
    expect(parseDiffMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('tool-summary')).not.toBeInTheDocument();
  });

  it('keeps mixed legacy tool groups in View Steps without dropping non-file tools', () => {
    const message = createToolGroup([
      {
        call_id: 'write-1',
        description: 'Write file',
        name: 'WriteFile',
        render_output_as_markdown: false,
        result_display: {
          file_diff: 'diff --git a/file.ts b/file.ts\n-old\n+new',
          file_name: '/workspace/file.ts',
        },
        status: 'Success',
      },
      {
        call_id: 'read-1',
        description: 'Read file',
        name: 'ReadFile',
        render_output_as_markdown: false,
        result_display: 'done',
        status: 'Success',
      },
    ]);

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('tool-summary')).toHaveTextContent(message.id);
    expect(screen.queryByTestId('file-changes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tool-group')).not.toBeInTheDocument();
  });
});
