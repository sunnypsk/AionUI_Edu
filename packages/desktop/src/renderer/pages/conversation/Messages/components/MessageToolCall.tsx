/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageToolCall } from '@/common/chat/chatLib';
import { normalizeToolCall } from '@/common/chat/normalizeToolCall';
import type { NormalizedToolStatus } from '@/common/chat/normalizeToolCall';
import FileChangesPanel from '@/renderer/components/base/FileChangesPanel';
import { useDiffPreviewHandlers } from '@/renderer/hooks/file/useDiffPreviewHandlers';
import { parseDiff } from '@/renderer/utils/file/diffUtils';
import { Badge, Button, Image, Message, Tooltip } from '@arco-design/web-react';
import { Download, Edit } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { localFileRef } from '@/common/types/chatFile';
import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';
import { downloadFileFromRef } from '@/renderer/utils/file/download';
import { getAcpImageFileName } from '@/common/chat/acpToolCallOutput';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import ImageAnnotatorModal from '@renderer/pages/conversation/Messages/acp/ImageAnnotator';
import { attachImageEditToSendBox } from '@renderer/pages/conversation/Messages/acp/ImageAnnotator/attachImageEdit';
import type { ImageEditResult } from '@renderer/pages/conversation/Messages/acp/ImageAnnotator/types';
import { IconDown, IconRight } from '@arco-design/web-react/icon';
import { createTwoFilesPatch } from 'diff';
import React, { useMemo, useState } from 'react';
import type { BadgeProps } from '@arco-design/web-react';
import './MessageToolGroupSummary.css';

/**
 * Render raster tool images with authenticated preview and download.
 * `editable` marks generated results; Codex conversations then offer an annotate-and-regenerate editor.
 */
export const ToolImageGallery: React.FC<{
  images?: Array<{ path: string; mime_type: string }>;
  editable?: boolean;
}> = ({ images, editable = false }) => {
  const { t } = useTranslation();
  const [messageApi, context] = Message.useMessage();
  const conversation = useConversationContextSafe();
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const unique = [...new Map((images ?? []).map((image) => [image.path, image])).values()];
  const canEdit = editable && conversation?.backend === 'codex' && !conversation.hideSendBox;
  if (!unique.length) return null;
  const submitEdit = async (edit: ImageEditResult): Promise<void> => {
    if (!conversation || !editingPath) return;
    const prompt = edit.instruction
      ? t('acp.image.edit.prompt_with_instruction', { instruction: edit.instruction })
      : t('acp.image.edit.prompt');
    try {
      await attachImageEditToSendBox({
        conversationId: conversation.conversation_id,
        fileName: getAcpImageFileName(editingPath),
        edit,
        prompt,
      });
      setEditingPath(null);
      messageApi.success(t('acp.image.edit.attached'));
    } catch (error) {
      console.error('[ToolImageGallery] Failed to attach edited image:', error);
      messageApi.error(t('acp.image.edit.attach_error'));
    }
  };
  const download = async (path: string): Promise<void> => {
    try {
      await downloadFileFromRef(localFileRef(path), getAcpImageFileName(path));
    } catch {
      messageApi.error(t('acp.image.download_error'));
    }
  };
  return (
    <div className='flex flex-col gap-8px mt-3' data-testid='tool-image-gallery'>
      {context}
      {unique.map((image) => (
        <div key={image.path} className='group relative w-fit max-w-520px overflow-hidden rounded border bg-1 p-2'>
          <Image
            src={buildFileStreamUrl(localFileRef(image.path))}
            alt={getAcpImageFileName(image.path)}
            width='100%'
            className='max-w-full'
            style={{ maxWidth: '100%' }}
          />
          <Tooltip content={t('acp.image.download')}>
            <Button
              aria-label={t('acp.image.download_aria')}
              type='secondary'
              size='mini'
              shape='circle'
              className='!absolute end-10px top-10px'
              icon={<Download size='14' />}
              onClick={() => void download(image.path)}
            />
          </Tooltip>
          {canEdit && (
            <Tooltip content={t('acp.image.edit.open')}>
              <Button
                aria-label={t('acp.image.edit.open_aria')}
                type='secondary'
                size='mini'
                shape='circle'
                className='!absolute end-40px top-10px'
                icon={<Edit size='14' />}
                onClick={() => setEditingPath(image.path)}
              />
            </Tooltip>
          )}
        </div>
      ))}
      {canEdit && (
        <ImageAnnotatorModal
          visible={editingPath !== null}
          src={editingPath ? buildFileStreamUrl(localFileRef(editingPath)) : ''}
          onCancel={() => setEditingPath(null)}
          onSubmit={submitEdit}
        />
      )}
    </div>
  );
};

const statusToBadge = (status: NormalizedToolStatus): BadgeProps['status'] => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'error':
      return 'error';
    case 'running':
      return 'processing';
    default:
      return 'default';
  }
};

const ReplacePreview: React.FC<{ message: IMessageToolCall }> = ({ message }) => {
  const file_path = message.content.args?.file_path || message.content.input?.file_path || '';
  const old_string = message.content.args?.old_string ?? message.content.input?.old_string ?? '';
  const new_string = message.content.args?.new_string ?? message.content.input?.new_string ?? '';

  const diffText = useMemo(() => {
    return createTwoFilesPatch(file_path, file_path, old_string, new_string, '', '', { context: 3 });
  }, [file_path, old_string, new_string]);

  const fileInfo = useMemo(() => parseDiff(diffText, file_path), [diffText, file_path]);
  const display_name = file_path.split(/[/\\]/).pop() || file_path;
  const { handleFileClick, handleDiffClick } = useDiffPreviewHandlers({ diffText, display_name, file_path });

  return (
    <FileChangesPanel
      title={fileInfo.file_name}
      files={[fileInfo]}
      onFileClick={handleFileClick}
      onDiffClick={handleDiffClick}
      defaultExpanded={true}
    />
  );
};

const MessageToolCall: React.FC<{ message: IMessageToolCall }> = ({ message }) => {
  const { name } = message.content;
  const [expanded, setExpanded] = useState(false);

  if (name === 'replace' || name === 'Edit') {
    return <ReplacePreview message={message} />;
  }

  const normalized = normalizeToolCall(message);
  if (!normalized) {
    return <div className='text-t-primary'>{name}</div>;
  }

  const observationImages = normalized.imageRole !== 'generated' ? normalized.images : undefined;
  const hasDetail = normalized.input || normalized.output || observationImages?.length;

  return (
    <div className='flex flex-col'>
      <div className='flex flex-row color-#86909C gap-12px items-center'>
        <Badge
          status={statusToBadge(normalized.status)}
          className={normalized.status === 'running' ? 'badge-breathing' : ''}
        />
        <span
          className={
            'flex-1 min-w-0' +
            (expanded ? ' break-all' : ' truncate') +
            (hasDetail ? ' cursor-pointer hover:color-#4E5969' : '')
          }
          onClick={hasDetail ? () => setExpanded(!expanded) : undefined}
        >
          <span className='font-medium text-13px'>{normalized.name}</span>
          {normalized.description && <span className='m-l-4px opacity-80 text-13px'>{normalized.description}</span>}
        </span>
        {hasDetail && (
          <span
            className='flex-shrink-0 cursor-pointer hover:color-#4E5969 transition-colors'
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <IconDown style={{ fontSize: 12 }} /> : <IconRight style={{ fontSize: 12 }} />}
          </span>
        )}
      </div>
      {expanded && hasDetail && (
        <div className='tool-detail-panel m-l-20px m-t-4px'>
          {normalized.input && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>Input</div>
              <pre className='tool-detail-content'>{normalized.input}</pre>
            </div>
          )}
          {normalized.output && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>Output</div>
              <pre className='tool-detail-content'>{normalized.output}</pre>
            </div>
          )}
          <ToolImageGallery images={observationImages} />
        </div>
      )}
      {normalized.imageRole === 'generated' && <ToolImageGallery images={normalized.images} editable />}
    </div>
  );
};

export default MessageToolCall;
