import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@arco-design/web-react';
import {
  Download,
  Edit,
  FileExcel,
  FileMusic,
  FilePdf,
  FilePpt,
  FileText,
  FileWord,
  Pic,
  PreviewOpen,
} from '@icon-park/react';
import { useIsStreaming, type ComponentRenderer } from '@openuidev/react-lang';
import { useTranslation } from 'react-i18next';
import { joinPath } from '@/common/chat/chatLib';
import type { FileCardProps } from '@/common/openui/components';
import { localFileRef } from '@/common/types/chatFile';
import type { PreviewContentType } from '@/common/types/office/preview';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { usePreviewLauncher } from '@/renderer/hooks/file/usePreviewLauncher';
import { useOptionalPreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { getContentTypeByExtension } from '@/renderer/pages/conversation/Preview/fileUtils';
import { downloadFileFromRef } from '@/renderer/utils/file/download';
import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';
import { previewErrorToI18nKey, type PreviewErrorKind } from '@/renderer/utils/previewError';
import styles from './OpenUIComponents.module.css';
import { useFileDownload } from './FileDownloads';
import { AudioPlayer } from './AudioPlayer';
import { listeningPagePath } from '@/renderer/pages/listening/route';

const AUDIO_EXTENSIONS = /\.(?:mp3|wav|m4a|ogg)$/i;
const LISTENING_PROJECT = /\.listening\.json$/i;

/**
 * Return a `/`-separated workspace-relative path, or null for anything that could leave the
 * workspace: empty, absolute (`/`, `C:\`, `\\server`), URL schemes or any `..` segment.
 */
export function normalizeWorkspacePath(path: string): string | null {
  const unified = path.trim().replace(/\\/g, '/');
  if (!unified || unified.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(unified)) return null;
  const parts = unified.split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.includes('..')) return null;
  return parts.join('/');
}

const ICONS: Partial<Record<PreviewContentType, React.ElementType>> = {
  ppt: FilePpt,
  word: FileWord,
  pdf: FilePdf,
  excel: FileExcel,
  image: Pic,
};

/** Preview needs the conversation's preview panel; only mount the launcher where one exists. */
function PreviewButton({
  path,
  disabled,
  onError,
}: {
  path: string;
  disabled: boolean;
  onError: (kind: PreviewErrorKind) => void;
}) {
  const { t } = useTranslation();
  const { launchPreview, loading, errorKind } = usePreviewLauncher();
  useEffect(() => {
    if (errorKind) onError(errorKind);
  }, [errorKind, onError]);
  return (
    <Button
      size='small'
      icon={<PreviewOpen />}
      loading={loading}
      disabled={disabled}
      onClick={() =>
        void launchPreview({ relativePath: path, contentType: getContentTypeByExtension(path), editable: false })
      }
    >
      {t('messages.openui.file.preview')}
    </Button>
  );
}

/** A file produced in the conversation workspace, with preview and download. */
export const FileCardRenderer: ComponentRenderer<FileCardProps> = ({ props }) => {
  const { t } = useTranslation();
  const streaming = useIsStreaming();
  const preview = useOptionalPreviewContext();
  const conversation = useConversationContextSafe();
  const workspace = conversation?.workspace;
  /** An i18n key for the last preview or download failure. */
  const [problem, setProblem] = useState<string | null>(null);
  const path = normalizeWorkspacePath(props.path ?? '');
  const name = path?.split('/').pop() ?? props.path;
  const audio = !!path && AUDIO_EXTENSIONS.test(path);
  const listening = !!path && LISTENING_PROJECT.test(path);
  const Icon = audio ? FileMusic : (path && ICONS[getContentTypeByExtension(path)]) || FileText;
  const disabled = streaming || !workspace;
  useFileDownload(path, !disabled);
  const status = !path ? 'messages.openui.file.invalidPath' : !workspace ? 'messages.openui.file.unavailable' : problem;
  const reportPreview = useCallback((kind: PreviewErrorKind) => setProblem(previewErrorToI18nKey(kind)), []);
  const download = async () => {
    if (!path || !workspace) return;
    try {
      await downloadFileFromRef(localFileRef(joinPath(workspace, path)), name);
    } catch (error) {
      // downloadFileFromRef reports the HTTP status in its message; a 404 means the file is missing.
      const missing = error instanceof Error && /\(404\)/.test(error.message);
      setProblem(missing ? previewErrorToI18nKey('not_found') : 'messages.openui.file.downloadError');
    }
  };
  return (
    <div className={styles.fileCard}>
      <Icon theme='outline' size='28' className={styles.fileIcon} />
      <div className={styles.fileBody}>
        <div className={styles.fileTitle}>{props.title || name}</div>
        {props.description && <div className={styles.fileDescription}>{props.description}</div>}
        {status && (
          <div className={styles.fileStatus} role='status'>
            {t(status)}
          </div>
        )}
      </div>
      {path && (
        <div className={styles.fileActions}>
          {listening && (
            <Button
              size='small'
              type='primary'
              icon={<Edit />}
              disabled={disabled}
              onClick={() => {
                // Setting the hash also works where the card renders outside the router.
                if (conversation) window.location.hash = `#${listeningPagePath(conversation.conversation_id, path)}`;
              }}
            >
              {t('messages.listening.edit')}
            </Button>
          )}
          {preview && !audio && !listening && <PreviewButton path={path} disabled={disabled} onError={reportPreview} />}
          <Button size='small' icon={<Download />} disabled={disabled} onClick={() => void download()}>
            {/* A listening card holds only the project file; the MP3 and portable ZIP live in the editor. */}
            {t(listening ? 'messages.listening.download.json' : 'messages.openui.file.download')}
          </Button>
        </div>
      )}
      {audio && workspace && !streaming && (
        <div className={styles.fileAudio}>
          <AudioPlayer url={buildFileStreamUrl(localFileRef(joinPath(workspace, path!)))} />
        </div>
      )}
    </div>
  );
};
