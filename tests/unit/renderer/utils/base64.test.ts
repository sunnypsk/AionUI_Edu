/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { CFB } from 'xlsx-republish';
import { base64ToBlob, BINARY_MIME_MAP } from '@/renderer/utils/file/base64';
import { createStoredZip, downloadFilesAsZip } from '@/renderer/utils/file/download';

vi.mock('@/common', () => ({ ipcBridge: {} }));
vi.mock('@/renderer/utils/file/fileUrls', () => ({
  buildFileStreamUrl: (file: { path: string }) => '/stream?path=' + encodeURIComponent(file.path),
}));

const zipReader = CFB as {
  read: (
    data: Buffer,
    options: { type: 'buffer' }
  ) => { FullPaths: string[]; FileIndex: Array<{ content?: Uint8Array }> };
};

describe('ZIP file downloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('produces an independently readable UTF-8 ZIP retaining directories and exact binary bytes', async () => {
    const bytes = new Uint8Array([0, 255, 1, 128]);
    const blob = createStoredZip([
      { name: '甲/小測.docx', data: bytes.buffer },
      { name: '乙/小測.docx', data: new TextEncoder().encode('答案').buffer },
    ]);
    const zip = zipReader.read(Buffer.from(await blob.arrayBuffer()), { type: 'buffer' });
    // CFB reads raw filename bytes but does not implement ZIP's UTF-8 flag.
    const names = zip.FullPaths.map((name) => Buffer.from(name, 'binary').toString('utf8'));
    const index = names.findIndex((name) => name.endsWith('甲/小測.docx'));
    expect(index).toBeGreaterThanOrEqual(0);
    expect([...zip.FileIndex[index].content!]).toEqual([...bytes]);
    expect(names.some((name) => name.endsWith('乙/小測.docx'))).toBe(true);
  });

  it('records the standard CRC-32 check value', async () => {
    const blob = createStoredZip([{ name: 'check.txt', data: new TextEncoder().encode('123456789').buffer }]);
    expect(new DataView(await blob.arrayBuffer()).getUint32(14, true)).toBe(0xcbf43926);
  });

  it.each(['../secret', '/etc/passwd', 'C:\\secret', 'a/../../b', 'a\0b'])(
    'rejects unsafe archive names: %j',
    (name) => {
      expect(() => createStoredZip([{ name, data: new ArrayBuffer(1) }])).toThrow('ZIP_INVALID_NAME');
    }
  );

  it('rejects duplicate names and empty file lists', () => {
    const entry = { name: 'test.docx', data: new ArrayBuffer(1) };
    expect(() => createStoredZip([entry, entry])).toThrow('ZIP_INVALID_NAME');
    expect(() => createStoredZip([])).toThrow('ZIP_INVALID_FILES');
  });

  it('does not start a partial download when a later file is missing', async () => {
    const fetchFile = vi
      .fn()
      .mockResolvedValueOnce(new Response('first'))
      .mockResolvedValueOnce(new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetchFile);
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    await expect(
      downloadFilesAsZip(
        [
          { file: { kind: 'local', path: '/ws/first.docx' }, name: 'first.docx' },
          { file: { kind: 'local', path: '/ws/missing.docx' }, name: 'missing.docx' },
        ],
        'files.zip'
      )
    ).rejects.toThrow('(404)');
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('rejects an oversized advertised response before reading it into memory', async () => {
    const response = new Response('large', { headers: { 'content-length': String(129 * 1024 * 1024) } });
    const read = vi.spyOn(response, 'arrayBuffer');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(
      downloadFilesAsZip([{ file: { kind: 'local', path: '/ws/large.pdf' }, name: 'large.pdf' }], 'files.zip')
    ).rejects.toThrow('ZIP_TOO_LARGE');
    expect(read).not.toHaveBeenCalled();
  });
});

describe('base64 utils', () => {
  describe('base64ToBlob', () => {
    it('decodes base64 data URL to Blob', () => {
      const base64 = btoa('Hello, World!');
      const dataUrl = `data:text/plain;base64,${base64}`;
      const blob = base64ToBlob(dataUrl, 'text/plain');

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toMatch(/^text\/plain/);
      expect(blob.size).toBe(13);
    });

    it('handles empty base64 string', () => {
      const dataUrl = 'data:text/plain;base64,';
      const blob = base64ToBlob(dataUrl, 'text/plain');

      expect(blob.size).toBe(0);
    });

    it('preserves MIME type from parameter', () => {
      const base64 = btoa('test');
      const dataUrl = `data:text/plain;base64,${base64}`;
      const blob = base64ToBlob(dataUrl, 'application/json');

      expect(blob.type).toMatch(/^application\/json/);
    });

    it('handles binary data', () => {
      const binaryData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      const binaryStr = String.fromCharCode(...binaryData);
      const base64 = btoa(binaryStr);
      const dataUrl = `data:image/jpeg;base64,${base64}`;
      const blob = base64ToBlob(dataUrl, 'image/jpeg');

      expect(blob.size).toBe(4);
      expect(blob.type).toBe('image/jpeg');
    });

    it('handles data URL without MIME type prefix', () => {
      const base64 = btoa('test');
      const dataUrl = base64;
      const blob = base64ToBlob(dataUrl, 'text/plain');

      expect(blob.size).toBe(0);
    });

    it('handles multiline base64', () => {
      const text = 'a'.repeat(100);
      const base64 = btoa(text);
      const dataUrl = `data:text/plain;base64,${base64}`;
      const blob = base64ToBlob(dataUrl, 'text/plain');

      expect(blob.size).toBe(100);
    });
  });

  describe('BINARY_MIME_MAP', () => {
    it('contains expected Office document MIME types', () => {
      expect(BINARY_MIME_MAP.xlsx).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(BINARY_MIME_MAP.docx).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(BINARY_MIME_MAP.pptx).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    });

    it('contains legacy Office MIME types', () => {
      expect(BINARY_MIME_MAP.xls).toBe('application/vnd.ms-excel');
      expect(BINARY_MIME_MAP.doc).toBe('application/msword');
      expect(BINARY_MIME_MAP.ppt).toBe('application/vnd.ms-powerpoint');
    });

    it('contains OpenDocument MIME types', () => {
      expect(BINARY_MIME_MAP.ods).toBe('application/vnd.oasis.opendocument.spreadsheet');
      expect(BINARY_MIME_MAP.odt).toBe('application/vnd.oasis.opendocument.text');
      expect(BINARY_MIME_MAP.odp).toBe('application/vnd.oasis.opendocument.presentation');
    });

    it('contains common file format MIME types', () => {
      expect(BINARY_MIME_MAP.pdf).toBe('application/pdf');
      expect(BINARY_MIME_MAP.csv).toBe('text/csv');
    });

    it('contains archive MIME types', () => {
      expect(BINARY_MIME_MAP.zip).toBe('application/zip');
      expect(BINARY_MIME_MAP.tar).toBe('application/x-tar');
      expect(BINARY_MIME_MAP.gz).toBe('application/gzip');
      expect(BINARY_MIME_MAP.bz2).toBe('application/x-bzip2');
      expect(BINARY_MIME_MAP['7z']).toBe('application/x-7z-compressed');
      expect(BINARY_MIME_MAP.rar).toBe('application/vnd.rar');
    });

    it('has all expected file extensions', () => {
      const extensions = Object.keys(BINARY_MIME_MAP);
      expect(extensions).toContain('xlsx');
      expect(extensions).toContain('pdf');
      expect(extensions).toContain('zip');
      expect(extensions).toContain('docx');
      expect(extensions.length).toBeGreaterThanOrEqual(16);
    });
  });
});
