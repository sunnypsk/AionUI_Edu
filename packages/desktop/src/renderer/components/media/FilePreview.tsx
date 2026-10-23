/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Close } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatByteSize } from '@/renderer/services/i18n/format';
import { getFileExtension } from '@/renderer/services/FileService';
import { ipcBridge } from '@/common';
import { Button, Image, Tooltip } from '@arco-design/web-react';
import fileIcon from '@/renderer/assets/icons/file-icon.svg';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']);

// Substring from the base64-encoded "Image not found" placeholder SVG returned by getImageBase64 on ENOENT.
// This is the aligned base64 encoding of ">Image not found<" within the SVG data URL.
const IMAGE_NOT_FOUND_B64_MARKER = 'kltYWdlIG5vdCBmb3VuZD';
const MAX_IMAGE_RETRIES = 5;
const IMAGE_RETRY_DELAY_MS = 800;

const isImageFile = (path: string): boolean => {
  const ext = path.toLowerCase().slice(path.lastIndexOf('.'));
  return IMAGE_EXTS.has(ext);
};

type FilePreviewProps = {
  path: string;
  onRemove: () => void;
  readonly?: boolean;
  /** Optional tooltip shown on the chip (e.g. "sent as a file path"). */
  hint?: string;
};

const FilePreview: React.FC<FilePreviewProps> = ({ path, onRemove, readonly = false, hint }) => {
  // Defensive check: ensure path is a string
  if (typeof path !== 'string') {
    console.error('[FilePreview] Invalid path type:', typeof path, path);
    return null;
  }

  const isImage = isImageFile(path);
  // Extract filename directly from path without cleaning timestamp suffix
  const file_name = path.split(/[\\/]/).pop() || '';
  const fileExt = getFileExtension(path).toUpperCase().replace('.', '');
  const { t, i18n } = useTranslation();
  const [imageUrl, setImageUrl] = useState<string>('');
  const [fileSize, setFileSize] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFileSize(null);
    ipcBridge.fs.getFileMetadata
      .invoke({ path })
      .then((metadata) => {
        if (!cancelled && Number.isFinite(metadata?.size) && metadata.size >= 0) setFileSize(metadata.size);
      })
      .catch((error) => {
        if (!cancelled) console.error('[FilePreview] Failed to get file metadata:', { path, error });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    setImageUrl('');
    // Retry when the file is not found yet (race condition: display message rendered
    // before the backend finishes copying the pasted image to the workspace).
    if (isImage) {
      let cancelled = false;
      let retryCount = 0;
      let retryTimer: ReturnType<typeof setTimeout>;

      const loadImage = () => {
        ipcBridge.fs.getImageBase64
          .invoke({ path })
          .then((base64) => {
            if (cancelled) return;
            if (!base64) {
              setImageUrl('');
              return;
            }
            if (base64.includes(IMAGE_NOT_FOUND_B64_MARKER) && retryCount < MAX_IMAGE_RETRIES) {
              retryCount++;
              retryTimer = setTimeout(loadImage, IMAGE_RETRY_DELAY_MS);
            } else {
              setImageUrl(base64);
            }
          })
          .catch((error) => {
            if (cancelled) return;
            console.error('[FilePreview] Failed to load image:', { path, error });
          });
      };

      loadImage();

      return () => {
        cancelled = true;
        clearTimeout(retryTimer);
      };
    }

    return undefined;
  }, [isImage, path]);

  const handleRemove = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onRemove();
  };

  const withHint = (chip: React.ReactElement) => (hint ? <Tooltip content={hint}>{chip}</Tooltip> : chip);

  if (isImage) {
    return withHint(
      <div className='relative inline-block'>
        <div className='rd-8px overflow-hidden border-1 border-solid b-color-border-2'>
          <Image
            src={imageUrl}
            alt={file_name}
            width={60}
            height={60}
            className='object-cover cursor-pointer'
            style={{ display: imageUrl ? 'block' : 'none' }}
            preview={Boolean(imageUrl)}
          />
          {!imageUrl && <div className='w-60px h-60px bg-bg-3'></div>}
        </div>
        {!readonly && (
          <Button
            type='text'
            size='mini'
            shape='circle'
            aria-label={t('common.remove')}
            className='absolute -top-4px -end-4px z-10'
            onClick={handleRemove}
            icon={<Close theme='filled' size='10' fill='var(--text-secondary)' />}
          />
        )}
      </div>
    );
  }

  return withHint(
    <div className='relative inline-block min-w-0 max-w-full mb-10px'>
      <div className='h-60px box-border max-w-full flex items-center gap-12px px-12px rd-8px bg-bg-2 border border-solid border-b-base'>
        <div className='w-40px h-40px rd-8px flex items-center justify-center flex-shrink-0'>
          <img className='w-full h-full object-contain' src={fileIcon} alt='' />
        </div>
        <div className='flex flex-col gap-2px min-w-0'>
          <span className='text-14px text-t-primary max-w-150px truncate' title={file_name}>
            {file_name}
          </span>
          <span className='text-12px text-t-secondary'>
            {[fileExt, fileSize === null ? '' : formatByteSize(fileSize, i18n.language)].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>
      {!readonly && (
        <Button
          type='text'
          size='mini'
          shape='circle'
          aria-label={t('common.remove')}
          className='absolute -top-4px -end-4px z-10'
          onClick={handleRemove}
          icon={<Close theme='filled' size='10' fill='var(--text-secondary)' />}
        />
      )}
    </div>
  );
};

export default FilePreview;
