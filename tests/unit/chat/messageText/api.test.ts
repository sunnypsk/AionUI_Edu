import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { callTool, resolveMessageId } from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUI/api';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/common/adapter/httpBridge', async (original) => ({ ...(await original<object>()), httpRequest: request }));
const assistant = (id: string) => ({ id, type: 'text', position: 'left', status: 'finish' });
beforeEach(() => request.mockReset());

describe('canonical OpenUI message identity', () => {
  it('uses the forked database row instead of the source stream ID', async () => {
    request.mockResolvedValueOnce(assistant('fork-row'));
    await expect(resolveMessageId('fork', 'fork-row', 'parent-stream')).resolves.toBe('fork-row');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toBe('/api/conversations/fork/messages/fork-row');
  });
  it('resolves a live renderer UUID to its persisted assistant message', async () => {
    request.mockRejectedValueOnce(new BackendHttpError({ method: 'GET', path: '/message', status: 404, body: {} }));
    request.mockResolvedValueOnce(assistant('stream-row'));
    await expect(resolveMessageId('conversation', 'renderer-uuid', 'stream-row')).resolves.toBe('stream-row');
    expect(request.mock.calls[1][1]).toBe('/api/conversations/conversation/messages/stream-row');
  });
  it('rejects user messages and unfinished assistant rows', async () => {
    request.mockResolvedValueOnce({ ...assistant('row'), position: 'right' });
    await expect(resolveMessageId('conversation', 'row')).rejects.toThrow('OPENUI_MESSAGE_NOT_FINAL');
    request.mockResolvedValueOnce({ ...assistant('row'), status: 'work' });
    await expect(resolveMessageId('conversation', 'row')).rejects.toThrow('OPENUI_MESSAGE_NOT_FINAL');
  });
  it('does not try a different identity after an authentication failure', async () => {
    request.mockRejectedValueOnce(new BackendHttpError({ method: 'GET', path: '/message', status: 401, body: {} }));
    await expect(resolveMessageId('conversation', 'row', 'source')).rejects.toMatchObject({ status: 401 });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('Core operation cancellation', () => {
  const tool = {
    tool_key: 'tool',
    mode: 'mutation' as const,
    arguments: {},
    message_id: 'message',
    block_id: '0',
    program_hash: 'hash',
    operation_id: 'action:1',
  };
  it('cancels the owned Core operation using an independent request when its renderer disappears', async () => {
    const controller = new AbortController();
    request.mockImplementationOnce(
      (_method, _path, _body, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          });
        })
    );
    request.mockResolvedValueOnce(undefined);
    const result = callTool('conversation', tool, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenLastCalledWith(
      'POST',
      '/api/conversations/conversation/openui/operations/action%3A1/cancel',
      undefined,
      expect.objectContaining({ sensitive: true })
    );
    expect(request.mock.calls[1][3].signal).not.toBe(controller.signal);
  });
  it('does not cancel a completed operation or start an already aborted operation', async () => {
    const controller = new AbortController();
    request.mockResolvedValueOnce({ content: [] });
    await callTool('conversation', tool, controller.signal);
    controller.abort();
    expect(request).toHaveBeenCalledTimes(1);
    await expect(callTool('conversation', tool, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
