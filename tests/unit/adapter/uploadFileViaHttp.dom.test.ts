/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPLOAD_ABORTED_ERROR, uploadFileViaHttp } from '@/renderer/services/FileService';

type WindowWithPort = Window & { __backendPort?: number };

let requests: UploadRequest[] = [];
let serverCsrf: string | undefined;
let serverStatus = 200;

class UploadRequest extends EventTarget {
  readonly upload = new EventTarget();
  readonly headers = new Map<string, string>();
  readonly send = vi.fn((_body: FormData): void => {
    queueMicrotask(() => {
      this.status = serverCsrf && this.headers.get('x-csrf-token') !== serverCsrf ? 403 : serverStatus;
      this.dispatchEvent(new Event('load'));
    });
  });
  status = 200;
  responseText = JSON.stringify({ success: true, data: '/workspace/uploads/cat.png' });

  constructor() {
    super();
    requests.push(this);
  }

  get statusText(): string {
    return this.status === 403 ? 'Forbidden' : 'OK';
  }

  open(_method: string, _url: string): void {}

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  abort(): void {
    this.dispatchEvent(new Event('abort'));
  }
}

const image = (): File => new File(['fictional image'], 'cat.png', { type: 'image/png' });

describe('authenticated multipart uploads', () => {
  beforeEach(() => {
    requests = [];
    serverCsrf = undefined;
    serverStatus = 200;
    delete (window as WindowWithPort).__backendPort;
    document.cookie = 'aionui-csrf-token=; Max-Age=0; Path=/';
    vi.stubGlobal('XMLHttpRequest', UploadRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as WindowWithPort).__backendPort;
    document.cookie = 'aionui-csrf-token=; Max-Age=0; Path=/';
  });

  it('uploads conversation images with the decoded CSRF cookie', async () => {
    document.cookie = 'aionui-csrf-token=edit%2Ftoken; Path=/';
    serverCsrf = 'edit/token';

    await expect(uploadFileViaHttp(image(), 'conversation-A', undefined, 'original.png')).resolves.toBe(
      '/workspace/uploads/cat.png'
    );

    const body = requests[0].send.mock.calls[0][0];
    expect(body.get('conversation_id')).toBe('conversation-A');
    expect(body.get('file_name')).toBe('original.png');
  });

  it('reads the current token separately for each upload after a cookie rotation', async () => {
    document.cookie = 'aionui-csrf-token=first; Path=/';
    serverCsrf = 'first';
    await uploadFileViaHttp(image(), 'conversation-A');
    document.cookie = 'aionui-csrf-token=second; Path=/';
    serverCsrf = 'second';
    await uploadFileViaHttp(image(), 'conversation-A');

    expect(requests.map((request) => request.headers.get('x-csrf-token'))).toEqual(['first', 'second']);
  });

  it('omits the CSRF header when no cookie was issued', async () => {
    await uploadFileViaHttp(image());

    expect(requests[0].headers.has('x-csrf-token')).toBe(false);
  });

  it('does not send a browser cookie to a local authenticated backend', async () => {
    (window as WindowWithPort).__backendPort = 12345;
    document.cookie = 'aionui-csrf-token=browser-only; Path=/';
    await uploadFileViaHttp(image());

    expect(requests[0].headers.has('x-csrf-token')).toBe(false);
  });

  it('reports a rejected upload instead of resolving a file path', async () => {
    serverStatus = 403;

    await expect(uploadFileViaHttp(image())).rejects.toThrow('Upload failed: 403 Forbidden');
  });

  it('does not send a canceled upload', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      uploadFileViaHttp(image(), undefined, undefined, undefined, { signal: controller.signal })
    ).rejects.toThrow(UPLOAD_ABORTED_ERROR);
    expect(requests[0].send).not.toHaveBeenCalled();
  });
});
