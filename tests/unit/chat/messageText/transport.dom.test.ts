import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpRequest, setClientRenderCapabilities } from '@/common/adapter/httpBridge';
import {
  createQueuedCommandItem,
  normalizeQueueState,
} from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
vi.mock('@/common/adapter/sessionRefresh', () => ({
  refreshSession: vi.fn().mockResolvedValue(false),
  WS_CLOSE_POLICY_VIOLATION: 1008,
}));
afterEach(() => {
  setClientRenderCapabilities([]);
  delete window.__backendPort;
  vi.unstubAllGlobals();
});
const response = () => new Response(JSON.stringify({ data: {} }), { headers: { 'content-type': 'application/json' } });
describe('OpenUI conversation transport', () => {
  it('advertises verified capability at the common WebUI send boundary', async () => {
    const request = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', request);
    setClientRenderCapabilities(['openui/1']);
    await httpRequest('POST', '/api/conversations/one/messages', { content: 'Create a form' });
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      content: 'Create a form',
      ui_capabilities: ['openui/1'],
    });
  });
  it('waits for compatibility verification before sending the very first message', async () => {
    const request = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', request);
    let verified: (value: string[]) => void = vi.fn();
    setClientRenderCapabilities(
      new Promise((resolve) => {
        verified = resolve;
      })
    );
    const send = httpRequest('POST', '/api/conversations/one/messages', { content: 'First' });
    expect(request).not.toHaveBeenCalled();
    verified(['openui/1']);
    await send;
    expect(JSON.parse(request.mock.calls[0][1].body).ui_capabilities).toEqual(['openui/1']);
  });
  it('does not advertise an unverified or desktop capability', async () => {
    const request = vi.fn().mockImplementation(async () => response());
    vi.stubGlobal('fetch', request);
    await httpRequest('POST', '/api/conversations/one/messages', { content: 'Hello' });
    setClientRenderCapabilities(['openui/1']);
    window.__backendPort = 1234;
    await httpRequest('POST', '/api/conversations/one/messages', { content: 'Desktop' });
    expect(request.mock.calls.map((call) => JSON.parse(call[1].body))).toEqual([
      { content: 'Hello' },
      { content: 'Desktop' },
    ]);
  });
  it('passes cancellation to the fetch request', async () => {
    const request = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', request);
    const controller = new AbortController();
    await httpRequest('GET', '/api/conversations/one/openui/tools', undefined, {
      signal: controller.signal,
      sensitive: true,
    });
    expect(request.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it('keeps form context in a persisted queue item', () => {
    const context = { message_id: 'assistant-one', block_id: '0', form_state: { topic: 'Poetry' } };
    const item = createQueuedCommandItem({ input: 'Continue', files: [], ui_action: context });
    const state = normalizeQueueState(JSON.parse(JSON.stringify({ items: [item], isPaused: false, mode: 'manual' })));
    expect(state.items[0].ui_action).toEqual(context);
  });
  it('rejects malformed persisted form context instead of silently dropping it', () => {
    const item = { id: 'one', input: 'Continue', files: [], created_at: 1, ui_action: { form_state: [] } };
    expect(normalizeQueueState({ items: [item] }).items).toEqual([]);
  });
});
