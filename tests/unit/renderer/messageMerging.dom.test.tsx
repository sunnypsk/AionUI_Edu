/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import type { IMessageAcpToolCall, IMessageText, IMessageThinking, IMessageToolCall } from '@/common/chat/chatLib';
import {
  MessageListLoadingProvider,
  MessageListProvider,
  MessagePaginationProvider,
  useAddOrUpdateMessage,
  useMessageLstCache,
  useMessageList,
  useReplaceWithAnchorWindow,
  useAcceptUserMessage,
  mergeLoadedPageWithCurrent,
} from '@/renderer/pages/conversation/Messages/hooks';

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      userCreated: {
        on: vi.fn().mockReturnValue(() => {}),
      },
      statusChanged: {
        on: vi.fn().mockReturnValue(() => {}),
      },
      turnCompleted: {
        on: vi.fn().mockReturnValue(() => {}),
      },
    },
    database: {
      getConversationMessages: {
        invoke: vi.fn(),
      },
      getConversationMessage: { invoke: vi.fn() },
    },
    realtime: { reconnected: { on: vi.fn().mockReturnValue(() => {}) } },
  },
}));

const CONVERSATION_ID = 'conversation-1';

function createTextMessage(msgId: string, content: string): IMessageText {
  return {
    id: `text-${msgId}-${content}`,
    type: 'text',
    msg_id: msgId,
    conversation_id: CONVERSATION_ID,
    position: 'left',
    content: {
      content,
    },
  };
}

function createThinkingMessage(msgId: string, content: string): IMessageThinking {
  return {
    id: `thinking-${msgId}-${content}`,
    type: 'thinking',
    msg_id: msgId,
    conversation_id: CONVERSATION_ID,
    position: 'left',
    content: {
      content,
      status: 'thinking',
    },
  };
}

function createThinkingDoneMessage(msgId: string, duration: number): IMessageThinking {
  return {
    id: `thinking-done-${msgId}`,
    type: 'thinking',
    msg_id: msgId,
    conversation_id: CONVERSATION_ID,
    position: 'left',
    content: {
      content: '',
      duration,
      status: 'done',
    },
  };
}

function createToolCallMessage(toolCallId: string): IMessageAcpToolCall {
  return {
    id: toolCallId,
    type: 'acp_tool_call',
    msg_id: toolCallId,
    conversation_id: CONVERSATION_ID,
    position: 'left',
    content: {
      session_id: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        tool_call_id: toolCallId,
        status: 'completed',
        title: 'Read file',
        kind: 'read',
      },
    },
  };
}

function TestWrapper({ children }: PropsWithChildren): JSX.Element {
  return <MessageListProvider value={[]}>{children}</MessageListProvider>;
}

function CacheWrapper({ children }: PropsWithChildren): JSX.Element {
  return (
    <MessageListLoadingProvider value={false}>
      <MessagePaginationProvider
        value={{ hasMoreBefore: false, hasMoreAfter: false, isLoadingBefore: false, isLoadingAnchor: false }}
      >
        <MessageListProvider value={[]}>{children}</MessageListProvider>
      </MessagePaginationProvider>
    </MessageListLoadingProvider>
  );
}

function useMessageHarness() {
  return {
    addOrUpdateMessage: useAddOrUpdateMessage(),
    messages: useMessageList(),
  };
}

function useAnchorMessageHarness() {
  return {
    addOrUpdateMessage: useAddOrUpdateMessage(),
    replaceWithAnchorWindow: useReplaceWithAnchorWindow(),
    messages: useMessageList(),
  };
}

async function flushMessageQueue(): Promise<void> {
  await act(async () => {
    vi.runAllTimers();
  });
}

describe('message merging', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('inserts a late accepted user row before its reply despite client clock skew', () => {
    const reply = { ...createTextMessage('reply', 'new answer'), turn_id: 'turn-new', created_at: 1 };
    const user = {
      ...createTextMessage('user', 'new question'),
      position: 'right' as const,
      turn_id: 'turn-new',
      created_at: 1000,
    };
    const merged = mergeLoadedPageWithCurrent(CONVERSATION_ID, [user], [reply]);
    expect(merged.map((row) => row.msg_id)).toEqual(['user', 'reply']);
  });

  it('keeps user and assistant rows separate even if their correlation ids match', async () => {
    const { result } = renderHook(useMessageHarness, { wrapper: TestWrapper });
    act(() => {
      result.current.addOrUpdateMessage(createTextMessage('shared', 'answer'));
      result.current.addOrUpdateMessage({ ...createTextMessage('shared', 'question'), position: 'right' });
    });
    await flushMessageQueue();
    expect(result.current.messages.map((row) => row.position)).toEqual(['left', 'right']);
  });

  it('keeps previously loaded older history before the latest persisted page', () => {
    const old = { ...createTextMessage('old', 'history'), created_at: 1 };
    const latest = { ...createTextMessage('latest', 'answer'), created_at: 3 };
    expect(mergeLoadedPageWithCurrent(CONVERSATION_ID, [latest], [old]).map((row) => row.msg_id)).toEqual([
      'old',
      'latest',
    ]);
  });

  it('matches native tool history by call id even when live frames share one turn message id', () => {
    const live: IMessageToolCall[] = ['inspect-1', 'inspect-2'].map((callId, index) => ({
      id: `live-${callId}`,
      msg_id: 'assistant-turn-message',
      turn_id: 'turn-1',
      type: 'tool_call',
      conversation_id: CONVERSATION_ID,
      created_at: index,
      content: {
        call_id: callId,
        name: 'mcpToolCall',
        args: {},
        status: 'completed',
        images: [{ path: `/owned/${callId}.png`, mime_type: 'image/png' }],
      },
    }));
    const persisted = live.map((row) => ({ ...row, id: row.content.call_id, msg_id: row.content.call_id }));
    const merged = mergeLoadedPageWithCurrent(CONVERSATION_ID, persisted, live);
    const replay = mergeLoadedPageWithCurrent(CONVERSATION_ID, persisted, merged);
    expect(replay.map((row) => row.id)).toEqual(['inspect-1', 'inspect-2']);
    expect(replay).toEqual(persisted);
  });

  it('does not replace a completed image result with an older running HTTP snapshot', () => {
    const live: IMessageToolCall = {
      id: 'live-image',
      msg_id: 'assistant-turn-message',
      type: 'tool_call',
      status: 'finish',
      conversation_id: CONVERSATION_ID,
      content: {
        call_id: 'image-call',
        name: 'imageGeneration',
        args: {},
        status: 'completed',
        images: [{ path: '/owned/result.png', mime_type: 'image/png' }],
      },
    };
    const persisted: IMessageToolCall = {
      ...live,
      id: 'image-call',
      msg_id: 'image-call',
      status: 'work',
      content: { ...live.content, status: 'running', images: undefined },
    };
    const merged = mergeLoadedPageWithCurrent(CONVERSATION_ID, [persisted], [live]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'image-call', status: 'finish', content: live.content });
  });

  it('matches ACP tool history by tool call id rather than the shared streaming message id', () => {
    const persisted = createToolCallMessage('acp-call');
    const live = { ...persisted, id: 'live-acp', msg_id: 'assistant-turn-message' };
    expect(mergeLoadedPageWithCurrent(CONVERSATION_ID, [persisted], [live])).toEqual([persisted]);
  });

  it('keeps a completed image when a terminal diagnostic shares its turn message id', async () => {
    const tool: IMessageToolCall = {
      id: 'live-image',
      msg_id: 'assistant-turn-message',
      type: 'tool_call',
      conversation_id: CONVERSATION_ID,
      content: {
        call_id: 'image-call',
        name: 'imageGeneration',
        args: {},
        status: 'completed',
        images: [{ path: '/owned/result.png', mime_type: 'image/png' }],
      },
    };
    const { result } = renderHook(useMessageHarness, { wrapper: TestWrapper });
    act(() => {
      result.current.addOrUpdateMessage(tool);
      result.current.addOrUpdateMessage({
        id: 'terminal-error',
        msg_id: tool.msg_id,
        type: 'tips',
        conversation_id: CONVERSATION_ID,
        content: { type: 'error', content: 'The final assistant request failed' },
      });
    });
    await flushMessageQueue();
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toEqual(tool);
    expect(result.current.messages[1].type).toBe('tips');
  });

  it('shows the accepted row without a WebSocket echo and deduplicates a later acknowledgement', async () => {
    const row = {
      ...createTextMessage('accepted', 'question'),
      id: 'server-id',
      position: 'right' as const,
      status: 'finish' as const,
      created_at: 1,
    };
    const { result } = renderHook(
      () => ({ accept: useAcceptUserMessage(CONVERSATION_ID), messages: useMessageList() }),
      { wrapper: TestWrapper }
    );
    await act(async () => {
      await result.current.accept({ msg_id: 'accepted', turn_id: 'turn-1', user_message: row });
    });
    await act(async () => {
      await result.current.accept({
        msg_id: 'accepted',
        turn_id: 'turn-1',
        user_message: { ...row, status: 'pending' },
      });
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ id: 'server-id', status: 'finish' });
  });

  it('loads the canonical user row for an older backend and ignores a row from another conversation', async () => {
    const lookup = vi.mocked(ipcBridge.database.getConversationMessage.invoke);
    const row = { ...createTextMessage('accepted', 'question'), position: 'right' as const };
    lookup.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, conversation_id: 'other' });
    const { result } = renderHook(
      () => ({ accept: useAcceptUserMessage(CONVERSATION_ID), messages: useMessageList() }),
      { wrapper: TestWrapper }
    );
    await act(async () => {
      await result.current.accept({ msg_id: 'accepted', turn_id: 'turn-1' });
    });
    await act(async () => {
      await result.current.accept({ msg_id: 'other', turn_id: 'turn-2' });
    });
    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['accepted']);
  });

  it('does not fail an accepted send when its display lookup fails', async () => {
    vi.mocked(ipcBridge.database.getConversationMessage.invoke).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(
      () => ({ accept: useAcceptUserMessage(CONVERSATION_ID), messages: useMessageList() }),
      { wrapper: TestWrapper }
    );
    await act(async () => {
      await expect(result.current.accept({ msg_id: 'accepted', turn_id: 'turn-1' })).resolves.toBeUndefined();
    });
    expect(result.current.messages).toEqual([]);
  });

  it('refills every missing cursor page after reconnect without duplicating the latest page', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    const row = (id: string, time: number) => ({ ...createTextMessage(id, id), created_at: time });
    const page = (id: string, time: number, more = false) => ({
      items: [row(id, time)],
      oldest_cursor: id,
      newest_cursor: id,
      has_more_before: false,
      has_more_after: more,
    });
    invoke.mockReset().mockResolvedValueOnce(page('base', 1));
    let reconnect: (() => void) | undefined;
    vi.mocked(ipcBridge.realtime.reconnected.on).mockImplementation((callback) => {
      reconnect = () => callback({ timestamp: 1 });
      return () => {};
    });
    const { result } = renderHook(
      () => {
        useMessageLstCache(CONVERSATION_ID);
        return useMessageList();
      },
      { wrapper: CacheWrapper }
    );
    await act(async () => {
      await Promise.resolve();
    });
    invoke.mockImplementation(async (params) => {
      if (!params.after) return page('tail', 4);
      if (params.after === 'base') return page('gap-1', 2, true);
      if (params.after === 'gap-1') return page('gap-2', 3, true);
      return page('tail', 4);
    });
    await act(async () => {
      reconnect?.();
      await Promise.resolve();
    });
    expect(result.current.map((message) => message.msg_id)).toEqual(['base', 'gap-1', 'gap-2', 'tail']);
    expect(invoke.mock.calls.filter(([params]) => params.after).map(([params]) => params.after)).toEqual([
      'base',
      'gap-1',
      'gap-2',
    ]);
  });

  it('refreshes a completed tool older than the latest page even when the newest cursor did not change', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    const user = {
      ...createTextMessage('user-anchor', 'question'),
      id: 'user-anchor',
      position: 'right' as const,
      created_at: 1,
    };
    const tool = { ...createToolCallMessage('old-tool'), created_at: 2 };
    tool.content.update.status = 'in_progress';
    const tail = { ...createTextMessage('tail', 'answer'), created_at: 100 };
    const page = (items: Array<IMessageText | IMessageAcpToolCall>) => ({
      items,
      oldest_cursor: 'user-anchor',
      newest_cursor: 'tail',
      has_more_before: false,
      has_more_after: false,
    });
    invoke.mockReset().mockResolvedValueOnce(page([user, tool, tail]));
    let finish: (() => void) | undefined;
    vi.mocked(ipcBridge.conversation.turnCompleted.on).mockImplementation((callback) => {
      finish = () =>
        callback({ session_id: CONVERSATION_ID, turn_id: 'turn-1', last_message: { content: null, created_at: 100 } });
      return () => {};
    });
    const { result } = renderHook(
      () => {
        useMessageLstCache(CONVERSATION_ID);
        return useMessageList();
      },
      { wrapper: CacheWrapper }
    );
    await act(async () => {
      await Promise.resolve();
    });
    const completed = {
      ...tool,
      content: { ...tool.content, update: { ...tool.content.update, status: 'completed' as const } },
    };
    invoke.mockImplementation(async (params) => page(params.anchor_message_id ? [user, completed, tail] : [tail]));
    await act(async () => {
      finish?.();
      await Promise.resolve();
    });
    expect((result.current.find((row) => row.id === 'old-tool') as IMessageAcpToolCall).content.update.status).toBe(
      'completed'
    );
  });

  it('keeps text segments split when tool calls interrupt the same msg_id stream', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(createTextMessage('msg-1', 'hello'));
      result.current.addOrUpdateMessage(createTextMessage('msg-1', ' world'));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].type).toBe('text');
    expect((result.current.messages[0] as IMessageText).content.content).toBe('hello world');

    act(() => {
      result.current.addOrUpdateMessage(createToolCallMessage('tool-1'));
      result.current.addOrUpdateMessage(createTextMessage('msg-1', 'again'));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.type)).toEqual(['text', 'acp_tool_call', 'text']);
    expect((result.current.messages[0] as IMessageText).content.content).toBe('hello world');
    expect((result.current.messages[2] as IMessageText).content.content).toBe('again');
  });

  it('keeps thinking segments split when tool calls interrupt the same msg_id stream', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(createThinkingMessage('msg-1', 'alpha'));
      result.current.addOrUpdateMessage(createThinkingMessage('msg-1', 'beta'));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].type).toBe('thinking');
    expect((result.current.messages[0] as IMessageThinking).content.content).toBe('alphabeta');

    act(() => {
      result.current.addOrUpdateMessage(createToolCallMessage('tool-1'));
      result.current.addOrUpdateMessage(createThinkingMessage('msg-1', 'gamma'));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.type)).toEqual(['thinking', 'acp_tool_call', 'thinking']);
    expect((result.current.messages[0] as IMessageThinking).content.content).toBe('alphabeta');
    expect((result.current.messages[2] as IMessageThinking).content.content).toBe('gamma');
  });

  it('merges thinking done updates into the existing thinking message instead of appending a completion message', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(createThinkingMessage('msg-1', 'alpha'));
      result.current.addOrUpdateMessage(createToolCallMessage('tool-1'));
      result.current.addOrUpdateMessage(createThinkingDoneMessage('msg-1', 4200));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.type)).toEqual(['thinking', 'acp_tool_call']);
    expect((result.current.messages[0] as IMessageThinking).content.status).toBe('done');
    expect((result.current.messages[0] as IMessageThinking).content.duration).toBe(4200);
  });

  it('ignores non-renderable transformed stream messages', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(undefined);
    });
    await flushMessageQueue();

    expect(result.current.messages).toEqual([]);
  });

  it('keeps live-only and richer streaming messages when replacing with an anchor window', async () => {
    const { result } = renderHook(() => useAnchorMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(createTextMessage('agent-1', 'partial streaming response'));
      result.current.addOrUpdateMessage(createTextMessage('agent-2', 'live tail'));
    });
    await flushMessageQueue();

    act(() => {
      result.current.replaceWithAnchorWindow(CONVERSATION_ID, [
        createTextMessage('user-anchor', 'anchor'),
        createTextMessage('agent-1', 'partial'),
      ]);
    });

    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['user-anchor', 'agent-1', 'agent-2']);
    expect((result.current.messages[1] as IMessageText).content.content).toBe('partial streaming response');
    expect((result.current.messages[2] as IMessageText).content.content).toBe('live tail');
  });

  it('requests compact tool content when hydrating historical messages', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockClear();
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    renderHook(() => useMessageLstCache(CONVERSATION_ID), {
      wrapper: CacheWrapper,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith({
      conversation_id: CONVERSATION_ID,
      limit: 50,
      content_mode: 'compact',
    });
  });

  it('flips a pending user message to finish when message.statusChanged arrives for it', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitUserCreated: ((payload: any) => void) | undefined;
    let emitStatusChanged: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((cb: any) => {
      emitUserCreated = cb;
      return () => {};
    });
    vi.mocked(ipcBridge.conversation.statusChanged.on).mockImplementation((cb: any) => {
      emitStatusChanged = cb;
      return () => {};
    });

    function useCacheAndListHarness() {
      useMessageLstCache(CONVERSATION_ID);
      return { messages: useMessageList() };
    }

    const { result } = renderHook(() => useCacheAndListHarness(), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-1',
        client_msg_id: 'client-1',
        content: 'sent mid-turn',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: Date.now(),
      });
    });

    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-1') as IMessageText | undefined)?.status
    ).toBe('pending');

    act(() => {
      emitStatusChanged?.({
        user_id: 'user-1',
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-1',
        status: 'finish',
      });
    });

    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-1') as IMessageText | undefined)?.status
    ).toBe('finish');
  });

  it('ignores message.statusChanged for a different conversation', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitUserCreated: ((payload: any) => void) | undefined;
    let emitStatusChanged: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((cb: any) => {
      emitUserCreated = cb;
      return () => {};
    });
    vi.mocked(ipcBridge.conversation.statusChanged.on).mockImplementation((cb: any) => {
      emitStatusChanged = cb;
      return () => {};
    });

    function useCacheAndListHarness() {
      useMessageLstCache(CONVERSATION_ID);
      return { messages: useMessageList() };
    }

    const { result } = renderHook(() => useCacheAndListHarness(), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-2',
        content: 'sent mid-turn',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: Date.now(),
      });
    });

    act(() => {
      emitStatusChanged?.({
        user_id: 'user-1',
        conversation_id: 'other-conversation',
        msg_id: 'msg-midturn-2',
        status: 'finish',
      });
    });

    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-2') as IMessageText | undefined)?.status
    ).toBe('pending');
  });

  it('reconciles a pending badge with the DB row when a turn completes for this conversation', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValueOnce({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitUserCreated: ((payload: any) => void) | undefined;
    let emitTurnCompleted: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((cb: any) => {
      emitUserCreated = cb;
      return () => {};
    });
    vi.mocked(ipcBridge.conversation.turnCompleted.on).mockImplementation((cb: any) => {
      emitTurnCompleted = cb;
      return () => {};
    });

    function useCacheAndListHarness() {
      useMessageLstCache(CONVERSATION_ID);
      return { messages: useMessageList() };
    }

    const { result } = renderHook(() => useCacheAndListHarness(), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-3',
        content: 'sent mid-turn',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: Date.now(),
      });
    });

    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-3') as IMessageText | undefined)?.status
    ).toBe('pending');

    // The reconcile reload returns the DB's authoritative 'finish' row — the
    // missed live statusChanged event never arrived, so this is the only
    // path that heals the badge.
    invoke.mockResolvedValueOnce({
      items: [
        {
          id: 'msg-midturn-3',
          msg_id: 'msg-midturn-3',
          conversation_id: CONVERSATION_ID,
          type: 'text',
          position: 'right',
          status: 'finish',
          hidden: false,
          created_at: Date.now(),
          content: { content: 'sent mid-turn' },
        },
      ],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    invoke.mockClear();

    act(() => {
      emitTurnCompleted?.({ session_id: CONVERSATION_ID, turn_id: 'turn-1' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalled();
    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-3') as IMessageText | undefined)?.status
    ).toBe('finish');
  });

  it('reconciles on turn completion even when the user row was completely missed', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitTurnCompleted: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.turnCompleted.on).mockImplementation((cb: any) => {
      emitTurnCompleted = cb;
      return () => {};
    });

    renderHook(() => useMessageLstCache(CONVERSATION_ID), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    invoke.mockClear();

    act(() => {
      emitTurnCompleted?.({ session_id: CONVERSATION_ID, turn_id: 'turn-1' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalled();
  });

  it('ignores turnCompleted for a different conversation even with a pending row', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitUserCreated: ((payload: any) => void) | undefined;
    let emitTurnCompleted: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((cb: any) => {
      emitUserCreated = cb;
      return () => {};
    });
    vi.mocked(ipcBridge.conversation.turnCompleted.on).mockImplementation((cb: any) => {
      emitTurnCompleted = cb;
      return () => {};
    });

    function useCacheAndListHarness() {
      useMessageLstCache(CONVERSATION_ID);
      return { messages: useMessageList() };
    }

    renderHook(() => useCacheAndListHarness(), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-4',
        content: 'sent mid-turn',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: Date.now(),
      });
    });

    invoke.mockClear();

    act(() => {
      emitTurnCompleted?.({ session_id: 'other-conversation', turn_id: 'turn-1' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).not.toHaveBeenCalled();
  });
});
