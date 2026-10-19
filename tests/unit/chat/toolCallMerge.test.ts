import { describe, expect, it } from 'vitest';
import { composeMessage, type IMessageToolCall, type TMessage } from '@/common/chat/chatLib';

const frame = (content: Partial<IMessageToolCall['content']>): IMessageToolCall =>
  ({
    id: 'x',
    msg_id: 'm',
    conversation_id: 'c',
    type: 'tool_call',
    content: { call_id: 'w1', args: {}, ...content },
  }) as IMessageToolCall;

describe('tool_call merging', () => {
  it('keeps name and input when the completed frame carries empty values', () => {
    const input = { type: 'webSearch', query: '', action: { type: 'search', query: 'q' } };
    const started = frame({ name: 'webSearch', input, status: 'running' });
    const done = frame({ name: '', status: 'completed', output: 'ok' });
    const list = composeMessage(started, [] as TMessage[], () => {});
    const merged = composeMessage(done, list, () => {});
    const content = (merged[0] as IMessageToolCall).content;
    expect(content.name).toBe('webSearch');
    expect(content.input).toEqual(input);
    expect(content.status).toBe('completed');
  });
});
