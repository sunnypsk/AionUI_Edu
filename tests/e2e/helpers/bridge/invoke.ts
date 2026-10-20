import type { Page } from '@playwright/test';
import { RESPONSE_MAPPERS } from './mappers';
import { HTTP_ROUTES } from './routes';

/**
 * Invoke a bridge provider from renderer test context.
 *
 * Preferred path: map `key` to a backend HTTP route and issue a `fetch` from
 * the renderer against `window.__backendPort`. This matches how the running
 * app talks to aioncore.
 *
 * Unmapped providers fail explicitly; browser tests use the HTTP contract.
 */
export async function invokeBridge<T = unknown>(
  page: Page,
  key: string,
  data?: unknown,
  timeoutMs = 10_000
): Promise<T> {
  const route = HTTP_ROUTES[key];
  if (route) {
    const params = (data ?? {}) as Record<string, unknown>;
    const resolvedPath = typeof route.path === 'function' ? route.path(params) : route.path;
    const body =
      route.method === 'GET' || route.method === 'DELETE' ? undefined : route.mapBody ? route.mapBody(params) : data;

    const raw = await page.evaluate(
      async ({ method, path, requestBody, requestTimeoutMs }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

        try {
          const headers: Record<string, string> = {};
          const csrf = document.cookie
            .split('; ')
            .find((entry) => entry.startsWith('aionui-csrf-token='))
            ?.split('=')[1];
          if (csrf) headers['x-csrf-token'] = decodeURIComponent(csrf);
          if (requestBody !== undefined) headers['Content-Type'] = 'application/json';

          const requestInit: RequestInit = {
            method,
            headers,
            signal: controller.signal,
          };
          if (requestBody !== undefined && method !== 'GET') {
            requestInit.body = JSON.stringify(requestBody);
          }

          const response = await fetch(new URL(path, window.location.origin).href, requestInit);

          if (!response.ok) {
            let errBody: unknown;
            try {
              errBody = await response.json();
            } catch {
              errBody = await response.text();
            }
            throw new Error(`Backend ${method} ${path} failed (${response.status}): ${JSON.stringify(errBody)}`);
          }

          const contentType = response.headers.get('Content-Type');
          if (!contentType?.includes('application/json')) {
            return undefined;
          }

          const json = (await response.json()) as { success?: boolean; data?: unknown };
          if (json && typeof json === 'object' && 'data' in json) {
            return json.data;
          }
          return json;
        } finally {
          clearTimeout(timer);
        }
      },
      {
        method: route.method,
        path: resolvedPath,
        requestBody: body,
        requestTimeoutMs: timeoutMs,
      }
    );

    return (route.mapResponse ? RESPONSE_MAPPERS[route.mapResponse](raw) : raw) as T;
  }

  throw new Error(`No WebUI HTTP route is mapped for bridge provider: ${key}`);
}
