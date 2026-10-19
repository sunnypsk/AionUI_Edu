/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageAcpToolCall, IMessageToolCall } from '@/common/chat/chatLib';
import { normalizeAcpToolCall, normalizeToolCall } from '@/common/chat/normalizeToolCall';
import { describe, expect, it } from 'vitest';

describe('normalizeAcpToolCall', () => {
  it('preserves generated image paths for grouped tool summaries', () => {
    const message: IMessageAcpToolCall = {
      id: 'ig_test_image',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'ig_test_image',
          status: 'completed',
          title: 'Image generation',
          kind: 'execute',
          raw_output: {
            image: {
              path: '/Users/test/.codex/generated_images/session/ig_test_image.png',
            },
          },
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: 'Revised prompt: 一张小猫照片',
              },
            },
          ],
        },
      },
    };

    const normalized = normalizeAcpToolCall(message);

    expect((normalized as { imagePath?: string } | undefined)?.imagePath).toBe(
      '/Users/test/.codex/generated_images/session/ig_test_image.png'
    );
  });

  it('reads the nested action.query of a Codex webSearch as the description', () => {
    const normalized = normalizeAcpToolCall({
      id: 'ws-1',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call',
          tool_call_id: 'ws-1',
          status: 'completed',
          title: 'webSearch',
          kind: 'fetch',
          raw_input: { action: { query: '香港天文台 明日天氣' } },
        },
      },
    } as unknown as IMessageAcpToolCall);
    expect(normalized?.name).toBe('webSearch');
    expect(normalized?.description).toBe('香港天文台 明日天氣');
  });

  const codexSearch = (input: Record<string, unknown>) =>
    ({
      id: 'm1',
      conversation_id: 'c1',
      type: 'tool_call',
      content: { call_id: 'ws-2', name: 'webSearch', args: input, input, status: 'completed' },
    }) as unknown as IMessageToolCall;

  it('derives a Codex tool_call webSearch description from action.query when query is empty', () => {
    const n = normalizeToolCall(
      codexSearch({ type: 'webSearch', query: '', action: { type: 'search', query: '香港天文台 明日天氣' } })
    );
    expect(n?.name).toBe('webSearch');
    expect(n?.description).toBe('香港天文台 明日天氣');
  });

  it('derives a Codex tool_call webSearch description from the top-level query', () => {
    const n = normalizeToolCall(codexSearch({ type: 'webSearch', query: '香港天文台 明日天氣' }));
    expect(n?.description).toBe('香港天文台 明日天氣');
  });
});
