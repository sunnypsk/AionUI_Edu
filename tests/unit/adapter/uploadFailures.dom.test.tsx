/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/common/adapter/httpBridge', async (original) => ({
  ...(await original<object>()),
  httpRequest: transport.request,
}));

import UploadProgressBar from '@/renderer/components/media/UploadProgressBar';
import { abortUploads, useUploadState } from '@/renderer/hooks/file/useUploadState';
import { FileService, UploadError, resetUploadLimit, uploadFileViaHttp } from '@/renderer/services/FileService';

const MAX = 256 * 1024 * 1024;
/** Size of the 2022 DSE original recording, which must upload unchanged. */
const ORIGINAL_BYTES = 83_081_452;

let requests: UploadRequest[] = [];
let respond: (request: UploadRequest) => void;

class UploadRequest extends EventTarget {
  readonly upload = new EventTarget();
  readonly send = vi.fn((_body: FormData): void => {
    queueMicrotask(() => {
      respond(this);
      this.dispatchEvent(new Event('load'));
    });
  });
  status = 200;
  statusText = 'OK';
  responseText = JSON.stringify({ success: true, data: '/workspace/uploads/reference.mp3' });
  constructor() {
    super();
    requests.push(this);
  }
  open(): void {}
  setRequestHeader(): void {}
  abort(): void {
    this.dispatchEvent(new Event('abort'));
  }
}

/** A File that reports a large size without allocating it. */
const sized = (name: string, size: number): File => {
  const file = new File(['x'], name, { type: 'audio/mpeg' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};
const list = (...files: File[]): FileList =>
  Object.assign(files, { item: (index: number) => files[index] ?? null }) as unknown as FileList;

function Probe() {
  const { isUploading } = useUploadState('sendbox');
  return (
    <>
      <span data-testid='uploading'>{String(isUploading)}</span>
      <UploadProgressBar source='sendbox' />
    </>
  );
}

describe('upload limits and visible failures', () => {
  beforeEach(() => {
    requests = [];
    respond = () => {};
    resetUploadLimit();
    transport.request.mockReset().mockResolvedValue({ maxBytes: MAX });
    vi.stubGlobal('XMLHttpRequest', UploadRequest);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    abortUploads();
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads the structured Core 413 body into a size failure', async () => {
    respond = (request) => {
      request.status = 413;
      request.responseText = JSON.stringify({
        success: false,
        error: 'too large',
        code: 'FILE_TOO_LARGE',
        details: { maxBytes: MAX },
      });
    };
    const failure = await uploadFileViaHttp(sized('big.mp3', MAX + 1)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UploadError);
    expect(failure).toMatchObject({ message: 'FILE_TOO_LARGE', failure: { code: 'FILE_TOO_LARGE', maxBytes: MAX } });
  });

  it('uploads the 83 MB original unchanged when it is under the server limit', async () => {
    const files = await FileService.processDroppedFiles(list(sized('2022 DSE.mp3', ORIGINAL_BYTES)), 'c1');
    expect(transport.request).toHaveBeenCalledWith('GET', '/api/fs/upload/limits', undefined, expect.anything());
    expect(requests).toHaveLength(1);
    expect((requests[0].send.mock.calls[0][0] as FormData).get('file')).toMatchObject({ size: ORIGINAL_BYTES });
    expect(files).toMatchObject([{ name: '2022 DSE.mp3', size: ORIGINAL_BYTES }]);
  });

  it('refuses a file over the limit before sending and explains both sizes', async () => {
    render(<Probe />);
    const files = await FileService.processDroppedFiles(list(sized('huge.wav', MAX + 1)), 'c1');
    expect(files).toEqual([]);
    expect(requests).toHaveLength(0);
    const row = await screen.findByTestId('upload-failed-item');
    expect(row).toHaveTextContent('common.fileAttach.tooLargeLimit');
    expect(screen.queryByTestId('upload-retry-btn')).toBeNull();
    // A listed failure must not keep the send button disabled.
    expect(screen.getByTestId('uploading')).toHaveTextContent('false');
    fireEvent.click(screen.getByTestId('upload-remove-btn'));
    expect(screen.queryByTestId('upload-failed-item')).toBeNull();
  });

  it('shows a generic server failure and delivers the file when a retry succeeds', async () => {
    render(<Probe />);
    respond = (request) => {
      request.status = 400;
      request.statusText = 'Bad Request';
    };
    const late = vi.fn();
    const files = await FileService.processDroppedFiles(list(sized('clip.mp3', 1000)), 'c1', 'sendbox', late);
    expect(files).toEqual([]);
    expect(await screen.findByTestId('upload-failed-item')).toHaveTextContent('common.fileAttach.failedRetry');
    respond = () => {};
    fireEvent.click(screen.getByTestId('upload-retry-btn'));
    await vi.waitFor(() => expect(late).toHaveBeenCalledOnce());
    expect(late.mock.calls[0][0]).toMatchObject([{ name: 'clip.mp3', path: '/workspace/uploads/reference.mp3' }]);
    expect(screen.queryByTestId('upload-failed-item')).toBeNull();
  });

  it('still uploads when the limit cannot be read, leaving enforcement to the server', async () => {
    transport.request.mockRejectedValue(new Error('404'));
    await FileService.processDroppedFiles(list(sized('clip.mp3', 1000)), 'c1');
    expect(requests).toHaveLength(1);
  });
});
