import { describe, expect, it } from 'vitest';
import { composeMessage, transformMessage, type IMessageToolCall, type TMessage } from '@/common/chat/chatLib';

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

it('upserts a replayed native image result without final text and keeps its started label', () => {
  const started = frame({ name: 'imageGeneration', status: 'running' });
  const result = transformMessage({
    type: 'tool_call',
    msg_id: 'm',
    conversation_id: 'c',
    turn_id: 'turn-image',
    data: { call_id: 'w1', status: 'completed', images: [{ path: '/owned/image.png', mime_type: 'image/png' }] },
  });
  const first = composeMessage(result, [started], () => {});
  const replay = composeMessage(result, first, () => {});
  expect(replay).toHaveLength(1);
  expect((replay[0] as IMessageToolCall).content).toMatchObject({
    name: 'imageGeneration',
    status: 'completed',
    images: [{ path: '/owned/image.png', mime_type: 'image/png' }],
  });
});
