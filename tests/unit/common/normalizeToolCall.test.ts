import { describe, expect, it } from 'vitest';
import type { IMessageAcpToolCall, IMessageToolCall } from '@/common/chat/chatLib';
import { normalizeAcpToolCall, normalizeToolCall } from '@/common/chat/normalizeToolCall';

describe('normalizeToolCall', () => {
  it('normalizes compact snake_case acp tool calls from history responses', () => {
    const result = normalizeAcpToolCall({
      id: 'message-1',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        _compact: {
          truncated: true,
          original_size: 90000,
          preview_chars: 4096,
        },
        update: {
          session_update: 'tool_call',
          tool_call_id: 'tool-1',
          status: 'completed',
          title: 'rg',
          kind: 'search',
          raw_input: { pattern: 'needle', path: '.' },
          content: [{ type: 'content', content: { type: 'text', text: 'preview' } }],
        },
      },
    } as unknown as IMessageAcpToolCall);

    expect(result).toMatchObject({
      key: 'tool-1',
      name: 'rg',
      status: 'completed',
      description: '"needle" in .',
      output: 'preview',
      truncated: true,
      messageId: 'message-1',
      conversationId: 'conversation-1',
    });
  });

  it('ignores malformed ACP content items in compact history output', () => {
    const result = normalizeAcpToolCall({
      id: 'message-2',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        update: {
          session_update: 'tool_call',
          tool_call_id: 'tool-2',
          status: 'completed',
          title: 'Edit file',
          kind: 'edit',
          content: [null, 'invalid', { type: 'diff', path: '/workspace/file.ts', old_text: 'old', new_text: 'new' }],
        },
      },
    } as unknown as IMessageAcpToolCall);

    expect(result?.output).toBe('[diff] /workspace/file.ts');
  });
});

describe('generated image metadata', () => {
  it('retains file metadata from persisted history without expanding tool output', () => {
    const message: IMessageToolCall = {
      id: 'call-1',
      conversation_id: 'conv-1',
      type: 'tool_call',
      content: {
        call_id: 'call-1',
        name: 'imageGen',
        args: {},
        status: 'completed',
        images: [
          { path: '/owned/result.png', mime_type: 'image/png' },
          { path: '/owned/unsafe.svg', mime_type: 'image/svg+xml' },
        ],
      },
    };
    expect(normalizeToolCall(message).images).toEqual([{ path: '/owned/result.png', mime_type: 'image/png' }]);
    expect(
      normalizeToolCall({ ...message, content: { ...message.content, status: 'canceled' } }).images
    ).toBeUndefined();
  });
});

describe('step label metadata', () => {
  const toolCall = (content: Partial<IMessageToolCall['content']>) =>
    normalizeToolCall({
      id: 'message-1',
      conversation_id: 'conversation-1',
      type: 'tool_call',
      content: { call_id: 'call-1', name: 'tool', args: {}, ...content },
    } as IMessageToolCall);

  it('recovers the command line of a Codex command step from its description', () => {
    expect(toolCall({ call_id: 'exec-1', name: 'Run', description: 'Run cat notes.md' })?.command).toBe('cat notes.md');
  });

  it('prefers the structured command input when present', () => {
    expect(toolCall({ name: 'commandExecution', input: { command: 'python3 build.py' } })?.command).toBe(
      'python3 build.py'
    );
  });

  it('records the server and tool of an MCP call', () => {
    expect(
      toolCall({ name: 'mcpToolCall', input: { type: 'mcpToolCall', server: 'docs', tool: 'read_text' } })
    ).toMatchObject({ command: undefined, mcp: { server: 'docs', tool: 'read_text' } });
  });

  it('leaves other tools without command or MCP metadata', () => {
    expect(toolCall({ name: 'webSearch', description: 'weather' })).toMatchObject({
      command: undefined,
      mcp: undefined,
    });
  });
});
