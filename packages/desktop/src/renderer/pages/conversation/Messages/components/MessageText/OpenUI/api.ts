import { httpRequest, isBackendHttpError } from '@/common/adapter/httpBridge';
import version from '@aionui/web-host/openui/version.json';
import type { OpenUiCapabilities, OpenUiSavedState, OpenUiTool } from './types';

export const openUiVersion = version;
export const openUiCapabilities = (): Promise<OpenUiCapabilities> =>
  httpRequest('GET', '/api/openui/capabilities', undefined, {
    silentStatuses: [404],
    sensitive: true,
    signal: AbortSignal.timeout(5000),
  });
export const isCompatible = (capability?: OpenUiCapabilities): boolean =>
  capability?.protocol === version.protocol && capability.hash === version.hash;
export const conversationPath = (id: string): string => '/api/conversations/' + encodeURIComponent(id);

async function readFinalMessageId(conversation: string, candidate: string): Promise<string> {
  const row = await httpRequest<{ id: string; type: string; position: string; status: string }>(
    'GET',
    conversationPath(conversation) + '/messages/' + encodeURIComponent(candidate),
    undefined,
    { sensitive: true, silentStatuses: [404] }
  );
  if (row.id !== candidate || row.type !== 'text' || row.position !== 'left' || row.status !== 'finish') {
    throw new Error('OPENUI_MESSAGE_NOT_FINAL');
  }
  return row.id;
}

/** Prefer the persisted row ID; live messages initially carry a renderer-only UUID. */
export async function resolveMessageId(conversation: string, rowId: string, sourceId?: string): Promise<string> {
  try {
    return await readFinalMessageId(conversation, rowId);
  } catch (error) {
    if (!isBackendHttpError(error) || error.status !== 404 || !sourceId || sourceId === rowId) throw error;
    return readFinalMessageId(conversation, sourceId);
  }
}
export const statePath = (conversation: string, message: string, block: string): string =>
  conversationPath(conversation) +
  '/messages/' +
  encodeURIComponent(message) +
  '/openui/' +
  encodeURIComponent(block) +
  '/state';
export const loadState = (path: string, signal?: AbortSignal): Promise<OpenUiSavedState> =>
  httpRequest('GET', path, undefined, { sensitive: true, signal });
export const saveState = (
  path: string,
  previous: OpenUiSavedState,
  state: Record<string, unknown>
): Promise<OpenUiSavedState> => httpRequest('PATCH', path, { ...previous, state }, { sensitive: true });
export const listTools = (conversation: string): Promise<OpenUiTool[]> =>
  httpRequest('GET', conversationPath(conversation) + '/openui/tools', undefined, { sensitive: true });

type ToolCall = {
  tool_key: string;
  mode: 'query' | 'mutation';
  arguments: Record<string, unknown>;
  message_id: string;
  block_id: string;
  program_hash: string;
  operation_id: string;
};

/** Keep the operation identity across authentication retries and cancel the Core RPC on unmount. */
export async function callTool(conversation: string, request: ToolCall, signal: AbortSignal) {
  const cancel = () => {
    void httpRequest(
      'POST',
      conversationPath(conversation) + '/openui/operations/' + encodeURIComponent(request.operation_id) + '/cancel',
      undefined,
      { sensitive: true, signal: AbortSignal.timeout(5000) }
    ).catch((): undefined => undefined);
  };
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await httpRequest<{
      content: Array<{ type: string; text?: string }>;
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    }>('POST', conversationPath(conversation) + '/openui/tools/call', request, { sensitive: true, signal });
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
