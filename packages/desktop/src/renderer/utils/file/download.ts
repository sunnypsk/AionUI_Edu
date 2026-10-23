/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ChatFileRef } from '@/common/types/chatFile';
import { buildFileStreamUrl } from './fileUrls';
import { base64ToBlob, BINARY_MIME_MAP } from './base64';

function triggerBlobDownload(blob: Blob, file_name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file_name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Download a file by reading its raw bytes from disk (works in both Electron and WebUI).
 * Uses getImageBase64 + in-memory atob decode to bypass CSP connect-src restrictions.
 */
export async function downloadFileFromPath(file_path: string, file_name: string, workspace?: string): Promise<void> {
  const dataUrl = await ipcBridge.fs.getImageBase64.invoke({ path: file_path, workspace });
  if (!dataUrl) {
    throw new Error('File data not found');
  }
  const ext = file_name.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = BINARY_MIME_MAP[ext] ?? 'application/octet-stream';
  const blob = base64ToBlob(dataUrl, mimeType);
  triggerBlobDownload(blob, file_name);
}

/**
 * Download a file addressed by its renderer-safe file reference.
 *
 * Fetch the backend's raw byte stream rather than carrying the complete file as
 * base64 inside JSON. This is the same endpoint used by PDF previews and works
 * through both Electron's local backend and WebUI's same-origin reverse proxy.
 */
export async function downloadFileFromRef(file: ChatFileRef, file_name: string): Promise<void> {
  const response = await fetch(buildFileStreamUrl(file));
  if (!response.ok) throw new Error(`File download failed (${response.status})`);
  const blob = await response.blob();
  if (blob.size === 0) throw new Error('File data is empty');
  triggerBlobDownload(blob, file_name);
}

/**
 * Download in-memory text content as a file.
 */
export function downloadTextContent(content: string, file_name: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  triggerBlobDownload(blob, file_name);
}

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

/** Build a UTF-8 ZIP with stored entries; Office and PDF files are already compressed. */
export function createStoredZip(files: ReadonlyArray<{ name: string; data: ArrayBuffer }>): Blob {
  if (!files.length || files.length > 0xffff) throw new Error('ZIP_INVALID_FILES');
  const entries: BlobPart[] = [];
  const directory: BlobPart[] = [];
  const names = new Set<string>();
  let offset = 0;
  let directorySize = 0;
  for (const file of files) {
    const name = file.name.replace(/\\/g, '/');
    if (
      !name ||
      name.startsWith('/') ||
      /^[a-z][a-z\d+.-]*:/i.test(name) ||
      name.includes('\0') ||
      name.split('/').some((part) => !part || part === '.' || part === '..') ||
      names.has(name)
    )
      throw new Error('ZIP_INVALID_NAME');
    names.add(name);
    const encoded = new TextEncoder().encode(name);
    if (encoded.length > 0xffff) throw new Error('ZIP_INVALID_NAME');
    const data = new Uint8Array(file.data);
    if (offset + directorySize + data.byteLength + encoded.length * 2 + 98 > MAX_ARCHIVE_BYTES)
      throw new Error('ZIP_TOO_LARGE');
    let crc = 0xffffffff;
    for (const byte of data) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new ArrayBuffer(30);
    const local = new DataView(header);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(12, 0x0021, true); // 1980-01-01, the earliest DOS date.
    local.setUint32(14, crc, true);
    local.setUint32(18, data.byteLength, true);
    local.setUint32(22, data.byteLength, true);
    local.setUint16(26, encoded.length, true);
    const central = new ArrayBuffer(46);
    const record = new DataView(central);
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(14, 0x0021, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, data.byteLength, true);
    record.setUint32(24, data.byteLength, true);
    record.setUint16(28, encoded.length, true);
    record.setUint32(42, offset, true);
    entries.push(header, encoded, file.data);
    directory.push(central, encoded);
    offset += 30 + encoded.length + data.byteLength;
    directorySize += 46 + encoded.length;
  }
  const end = new ArrayBuffer(22);
  const footer = new DataView(end);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, files.length, true);
  footer.setUint16(10, files.length, true);
  footer.setUint32(12, directorySize, true);
  footer.setUint32(16, offset, true);
  return new Blob([...entries, ...directory, end], { type: 'application/zip' });
}

/** Fetch all files through the existing authenticated stream and download one ZIP only after all succeed. */
export async function downloadFilesAsZip(
  files: ReadonlyArray<{ file: ChatFileRef; name: string }>,
  archiveName: string
): Promise<void> {
  const entries: Array<{ name: string; data: ArrayBuffer }> = [];
  let total = 0;
  for (const { file, name } of files) {
    const response = await fetch(buildFileStreamUrl(file));
    if (!response.ok) throw new Error(`File download failed (${response.status})`);
    if (total + Number(response.headers.get('content-length') || 0) > MAX_ARCHIVE_BYTES)
      throw new Error('ZIP_TOO_LARGE');
    const data = await response.arrayBuffer();
    if (!data.byteLength) throw new Error('File data is empty');
    total += data.byteLength;
    if (total > MAX_ARCHIVE_BYTES) throw new Error('ZIP_TOO_LARGE');
    entries.push({ name, data });
  }
  triggerBlobDownload(createStoredZip(entries), archiveName);
}
