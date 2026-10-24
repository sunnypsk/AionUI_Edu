/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button } from '@arco-design/web-react';
import {
  abortUpload,
  retryUpload,
  useActiveUploads,
  useUploadState,
  type ActiveUpload,
  type UploadSource,
} from '@/renderer/hooks/file/useUploadState';
import { formatFileSize } from '@/renderer/services/FileService';
import { CloseSmall, Redo } from '@icon-park/react';
import { useTranslation } from 'react-i18next';

/** Reason line for a failed upload; size errors name both the file size and the server limit. */
function FailureReason({ upload }: { upload: ActiveUpload }) {
  const { t, i18n } = useTranslation();
  const failure = upload.failure;
  if (failure?.code === 'FILE_TOO_LARGE')
    return (
      <>
        {failure.maxBytes
          ? t('common.fileAttach.tooLargeLimit', {
              size: formatFileSize(upload.size, 1, i18n.language),
              max: formatFileSize(failure.maxBytes, 0, i18n.language),
            })
          : t('common.fileAttach.tooLarge', { size: formatFileSize(upload.size, 1, i18n.language) })}
      </>
    );
  return <>{t('common.fileAttach.failedRetry')}</>;
}

/**
 * Thin progress bar shown while files are being uploaded, plus a row per upload. In-flight rows can
 * be cancelled; failed rows stay listed with their reason, a retry (when it can help) and remove.
 * Renders nothing when there is neither an upload in flight nor a failure to show.
 */
const UploadProgressBar: React.FC<{ source?: UploadSource }> = ({ source }) => {
  const { isUploading, activeCount, overallPercent } = useUploadState(source);
  const uploads = useActiveUploads(source);
  const { t } = useTranslation();

  if (!uploads.length) return null;

  return (
    <div className='px-12px py-4px text-12px color-text-3'>
      {isUploading && (
        <>
          <div className='flex justify-between mb-2px'>
            <span>
              {t('common.fileAttach.uploading', {
                count: activeCount,
                defaultValue: 'Uploading {{count}} file(s)...',
              })}
            </span>
            <span>{overallPercent}%</span>
          </div>
          <div className='h-3px rd-2px bg-fill-3 overflow-hidden'>
            <div
              className='h-full rd-2px bg-primary-6 transition-width duration-200 ease'
              style={{ width: `${overallPercent}%` }}
            />
          </div>
        </>
      )}
      <ul className='mt-6px flex flex-col gap-4px list-none p-0 m-0'>
        {uploads.map((upload) =>
          upload.status === 'failed' ? (
            <li
              key={upload.id}
              className='flex flex-wrap items-center gap-x-8px py-2px text-danger'
              data-testid='upload-failed-item'
              role='alert'
            >
              <span className='flex-1 min-w-0 truncate' title={upload.name}>
                {upload.name}
              </span>
              {upload.retryable && (
                <Button
                  size='mini'
                  type='text'
                  icon={<Redo theme='outline' size='12' />}
                  onClick={() => retryUpload(upload.id)}
                  data-testid='upload-retry-btn'
                >
                  {t('common.fileAttach.retry')}
                </Button>
              )}
              <Button
                size='mini'
                type='text'
                icon={<CloseSmall theme='outline' size='12' strokeWidth={3} />}
                aria-label={t('common.fileAttach.remove')}
                title={t('common.fileAttach.remove')}
                onClick={() => abortUpload(upload.id)}
                data-testid='upload-remove-btn'
              />
              <span className='w-full'>
                <FailureReason upload={upload} />
              </span>
            </li>
          ) : (
            <li key={upload.id} className='flex items-center gap-8px py-2px' data-testid='upload-progress-item'>
              <span className='flex-1 min-w-0 truncate' title={upload.name}>
                {upload.name}
              </span>
              <span className='flex-shrink-0 tabular-nums'>{upload.percent}%</span>
              <Button
                size='mini'
                type='text'
                shape='circle'
                icon={<CloseSmall theme='outline' size='12' strokeWidth={3} />}
                aria-label={t('common.fileAttach.cancelUpload', { defaultValue: 'Cancel upload' })}
                title={t('common.fileAttach.cancelUpload', { defaultValue: 'Cancel upload' })}
                onClick={() => abortUpload(upload.id)}
                data-testid='upload-cancel-btn'
              />
            </li>
          )
        )}
      </ul>
    </div>
  );
};

export default UploadProgressBar;
