import type { BrowserAction, BrowserControl, BrowserResult, BrowserState } from '@/common/types/platform/webRuntime';
import { httpRequest, isBackendHttpError } from '@/common/adapter/httpBridge';

/** Browser input can contain passwords or files. Never pass it through request-body debug logging. */
export async function browserRequest<T>(conversationId: string, operation: string, input?: unknown): Promise<T> {
  try {
    return await httpRequest<T>(
      input === undefined ? 'GET' : 'POST',
      `/api/edu/browser/${encodeURIComponent(conversationId)}/${operation}`,
      input,
      { sensitive: true }
    );
  } catch (error) {
    if (isBackendHttpError(error)) {
      const body = error.body as { error?: { code?: string } };
      throw new Error(body?.error?.code ?? 'BROWSER_UNAVAILABLE', { cause: error });
    }
    throw error;
  }
}

export const browserApi = {
  state: (id: string): Promise<BrowserState> => browserRequest(id, 'state'),
  frame: (id: string): Promise<BrowserResult> => browserRequest(id, 'frame'),
  action: (id: string, action: BrowserAction): Promise<BrowserResult> => browserRequest(id, 'action', action),
  control: (id: string, control: BrowserControl): Promise<BrowserResult> => browserRequest(id, 'control', { control }),
};
