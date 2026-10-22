/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import { buildMessageAnchors, type MessageAnchorItem } from '@/renderer/pages/conversation/Messages/anchorRail/anchors';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadConversationAnchors = vi.fn();
const httpRequest = vi.fn();

vi.mock('@/common/adapter/httpBridge', () => ({ httpRequest: (...args: unknown[]) => httpRequest(...args) }));

vi.mock('@/renderer/pages/conversation/Messages/anchorRail/loadAnchors', () => ({
  loadConversationAnchors: (...args: unknown[]) => loadConversationAnchors(...args),
}));

const { useConversationAnchors } =
  await import('@/renderer/pages/conversation/Messages/anchorRail/useConversationAnchors');
const { loadConversationAnchors: loadActualAnchors } = await vi.importActual<
  typeof import('@/renderer/pages/conversation/Messages/anchorRail/loadAnchors')
>('@/renderer/pages/conversation/Messages/anchorRail/loadAnchors');

/** Builds one user/assistant turn pair. */
const turn = (n: number): TMessage[] =>
  [
    {
      id: `u-${n}`,
      msg_id: `u-${n}`,
      conversation_id: 'c1',
      type: 'text',
      position: 'right',
      created_at: n * 2,
      content: { content: `question ${n}` },
    },
    {
      id: `a-${n}`,
      msg_id: `a-${n}`,
      conversation_id: 'c1',
      type: 'text',
      position: 'left',
      created_at: n * 2 + 1,
      content: { content: `answer ${n}` },
    },
  ] as unknown as TMessage[];

const history = (count: number) => Array.from({ length: count }, (_, i) => turn(i + 1)).flat();

describe('useConversationAnchors', () => {
  beforeEach(() => {
    loadConversationAnchors.mockReset();
  });

  it('covers the whole history even when the chat area has only paged in the tail', async () => {
    // The regression this exists for: reopening an old conversation used to show a
    // rail with only the newest page's turns, so earlier ones had no tick at all.
    loadConversationAnchors.mockResolvedValue(buildMessageAnchors(history(40)));
    const paged = history(40).slice(-4); // chat area holds the last 2 turns

    const { result } = renderHook(() => useConversationAnchors('c1', paged));

    await waitFor(() => expect(result.current).toHaveLength(40));
    expect(result.current[0]?.question).toContain('question 1');
    expect(result.current[39]?.question).toContain('question 40');
  });

  it('reads previews rather than whole message bodies', async () => {
    loadConversationAnchors.mockResolvedValue(history(3));
    renderHook(() => useConversationAnchors('c1', []));

    await waitFor(() => expect(loadConversationAnchors).toHaveBeenCalled());
    expect(loadConversationAnchors).toHaveBeenCalledWith('c1', expect.any(AbortSignal));
  });

  it('lets newly sent messages extend the rail without re-reading history', async () => {
    loadConversationAnchors.mockResolvedValue(buildMessageAnchors(history(5)));
    const { result, rerender } = renderHook(({ live }) => useConversationAnchors('c1', live), {
      initialProps: { live: history(5) },
    });

    await waitFor(() => expect(result.current).toHaveLength(5));

    // A new turn arrives in memory; the rail must grow immediately.
    rerender({ live: history(6) });
    await waitFor(() => expect(result.current).toHaveLength(6));
    expect(loadConversationAnchors).toHaveBeenCalledTimes(1);
  });

  it('extends a long history from only the live tail and updates the streaming reply', async () => {
    loadConversationAnchors.mockResolvedValue(buildMessageAnchors(history(40)));
    const { result, rerender } = renderHook(({ live }) => useConversationAnchors('c1', live), {
      initialProps: { live: turn(40) },
    });
    await waitFor(() => expect(result.current).toHaveLength(40));
    rerender({ live: [turn(40)[0], ...turn(41)] });
    expect(result.current).toHaveLength(41);
    expect(result.current[40]).toMatchObject({ index: 41, answer: 'answer 41' });
  });

  it('aborts active HTTP reads on navigation and unmount', () => {
    loadConversationAnchors.mockImplementation(() => new Promise(() => {}));
    const { rerender, unmount } = renderHook(({ id }) => useConversationAnchors(id, []), {
      initialProps: { id: 'c1' },
    });
    const firstSignal = loadConversationAnchors.mock.calls[0][1] as AbortSignal;
    rerender({ id: 'c2' });
    expect(firstSignal.aborted).toBe(true);
    const secondSignal = loadConversationAnchors.mock.calls[1][1] as AbortSignal;
    unmount();
    expect(secondSignal.aborted).toBe(true);
  });

  it('drops the previous conversation ticks when switching', async () => {
    loadConversationAnchors.mockImplementation((id: string) =>
      Promise.resolve(buildMessageAnchors(id === 'c1' ? history(30) : history(2)))
    );

    const { result, rerender } = renderHook(({ id }) => useConversationAnchors(id, []), {
      initialProps: { id: 'c1' },
    });
    await waitFor(() => expect(result.current).toHaveLength(30));

    rerender({ id: 'c2' });
    // Must not keep showing c1's 30 ticks while c2 is open.
    await waitFor(() => expect(result.current).toHaveLength(2));
  });

  it('ignores a slow response that lands after the conversation changed', async () => {
    let resolveFirst: ((messages: MessageAnchorItem[]) => void) | undefined;
    loadConversationAnchors.mockImplementation((id: string) => {
      if (id === 'c1') return new Promise<MessageAnchorItem[]>((resolve) => (resolveFirst = resolve));
      return Promise.resolve(buildMessageAnchors(history(3)));
    });

    const { result, rerender } = renderHook(({ id }) => useConversationAnchors(id, []), {
      initialProps: { id: 'c1' },
    });
    rerender({ id: 'c2' });
    await waitFor(() => expect(result.current).toHaveLength(3));

    // c1's request finally resolves — it must not overwrite c2's ticks.
    await act(async () => {
      resolveFirst?.(buildMessageAnchors(history(30)));
    });
    expect(result.current).toHaveLength(3);
  });

  it('falls back to the in-memory list when the history read fails', async () => {
    loadConversationAnchors.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useConversationAnchors('c1', history(2)));

    // Degrades to whatever the chat area has, rather than rendering nothing.
    await waitFor(() => expect(result.current).toHaveLength(2));
  });

  it('renders no ticks without a conversation', () => {
    const { result } = renderHook(() => useConversationAnchors(undefined, []));
    expect(result.current).toEqual([]);
    expect(loadConversationAnchors).not.toHaveBeenCalled();
  });
});

describe('loadConversationAnchors', () => {
  beforeEach(() => httpRequest.mockReset());

  it('paginates bounded previews without fetching message bodies', async () => {
    httpRequest
      .mockResolvedValueOnce({
        items: [{ id: 'u1', msg_id: null, question: 'first\nquestion', answer: 'a'.repeat(512) }],
        next_cursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'u2', msg_id: 'm2', question: 'second', answer: '' }],
        next_cursor: null,
      });
    const signal = new AbortController().signal;
    const anchors = await loadActualAnchors('c/1', signal);
    expect(anchors.map((anchor) => [anchor.index, anchor.question])).toEqual([
      [1, 'first question'],
      [2, 'second'],
    ]);
    expect(anchors[0].answer.length).toBeLessThanOrEqual(121);
    expect(httpRequest).toHaveBeenLastCalledWith(
      'GET',
      '/api/conversations/c%2F1/messages/anchors?limit=200&after=cursor-1',
      undefined,
      { signal }
    );
  });

  it('never follows a next-page cursor after cancellation', async () => {
    const controller = new AbortController();
    httpRequest.mockImplementation(async () => {
      controller.abort();
      return { items: [], next_cursor: 'next' };
    });
    await expect(loadActualAnchors('c1', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(httpRequest).toHaveBeenCalledTimes(1);
  });

  it('rejects repeated cursors instead of fetching forever', async () => {
    httpRequest.mockResolvedValue({ items: [], next_cursor: 'same' });
    await expect(loadActualAnchors('c1', new AbortController().signal)).rejects.toThrow('did not advance');
    expect(httpRequest).toHaveBeenCalledTimes(2);
  });
});
