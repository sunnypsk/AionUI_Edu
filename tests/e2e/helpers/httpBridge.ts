import type { Page } from '@playwright/test';

/** Issue same-origin, cookie-authenticated API calls through the WebUI gateway. */

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function httpInvoke<T = unknown>(
  page: Page,
  method: HttpMethod,
  path: string,
  body?: unknown
): Promise<T> {
  return page.evaluate(
    async ({ method: m, path: p, body: b }) => {
      const url = new URL(p, window.location.origin).href;
      // DELETE routes require Content-Type: application/json AND a JSON-parseable
      // body even when the operation takes no body (e.g. DELETE /api/skills/external-paths
      // where the path is in the query string). Send `{}` as default body for DELETE.
      const effectiveBody = b !== undefined ? b : m === 'DELETE' ? {} : undefined;
      const headers: Record<string, string> = {};
      const csrf = document.cookie
        .split('; ')
        .find((entry) => entry.startsWith('aionui-csrf-token='))
        ?.split('=')[1];
      if (csrf) headers['x-csrf-token'] = decodeURIComponent(csrf);
      if (effectiveBody !== undefined) headers['Content-Type'] = 'application/json';

      const requestInit: RequestInit = {
        method: m,
        headers,
      };
      if (effectiveBody !== undefined && m !== 'GET') {
        requestInit.body = JSON.stringify(effectiveBody);
      }

      const res = await fetch(url, requestInit);

      if (!res.ok) {
        let errText: string;
        try {
          errText = JSON.stringify(await res.json());
        } catch {
          errText = await res.text();
        }
        throw new Error(`Backend ${m} ${p} failed (${res.status}): ${errText}`);
      }

      const contentType = res.headers.get('Content-Type');
      if (!contentType?.includes('application/json')) {
        return undefined;
      }

      const json = await res.json();
      if (json && typeof json === 'object' && 'data' in json) {
        return (json as { data: unknown }).data;
      }
      return json;
    },
    { method, path, body }
  ) as Promise<T>;
}

export const httpGet = <T = unknown>(page: Page, path: string) => httpInvoke<T>(page, 'GET', path);
export const httpPost = <T = unknown>(page: Page, path: string, body?: unknown) =>
  httpInvoke<T>(page, 'POST', path, body);
export const httpDelete = <T = unknown>(page: Page, path: string) => httpInvoke<T>(page, 'DELETE', path);
