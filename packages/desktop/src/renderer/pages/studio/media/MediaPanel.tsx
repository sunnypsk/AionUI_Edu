import React, { useEffect, useState } from 'react';
import {
  Button,
  Empty,
  Message,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Tooltip,
  Upload as FileUpload,
} from '@arco-design/web-react';
import { AudioFile, Delete, Plus, Text, Upload } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import type { AudioTaskView } from '@/common/types/platform/audioTools';
import type { StudioMedia } from '@/common/types/platform/audioStudio';
import { listeningError } from '@/renderer/pages/listening/data/api';
import { errorKey, formatTimestamp } from '@/renderer/pages/listening/data/status';
import type { EditorPanelContext } from '@/renderer/pages/listening/layout/ListeningEditor';
import { blockSegments, textSegments } from '@/renderer/pages/studio/data/segments';
import { studioApi } from '@/renderer/pages/studio/data/studioApi';
import { TextImportModal } from '@/renderer/pages/studio/media/TextImportModal';
import styles from '@/renderer/pages/studio/StudioPage.module.css';

const ACCEPT = '.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.webm,audio/*';
const isActive = (task?: AudioTaskView): boolean => task?.status === 'queued' || task?.status === 'running';

/**
 * Studio media browser: upload recordings (split into transcribed blocks in the background), add a recording's
 * blocks to the timeline, and turn text into speech blocks.
 */
export function MediaPanel({
  projectId,
  context,
  transcriptionAvailable,
}: {
  projectId: string;
  context: EditorPanelContext;
  transcriptionAvailable: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const [message, messageHolder] = Message.useMessage();
  const { data: media, mutate, isLoading } = useSWR(['studio.media', projectId], ([, id]) => studioApi.media(id));
  const [uploading, setUploading] = useState(0);
  const [busyPath, setBusyPath] = useState<string>();
  const [textOpen, setTextOpen] = useState(false);
  const imports = context.tasks.filter((task) => task.kind === 'import');
  /** Newest import task per recording; the host lists tasks newest first. */
  const importOf = (path: string) => imports.find((task) => task.sourcePath === path);
  const finished = imports
    .filter((task) => !isActive(task))
    .map((task) => task.id)
    .join(',');
  // A finished import changes block counts and transcripts, so reload the list.
  useEffect(() => {
    void mutate();
  }, [finished, mutate]);

  const fail = (error: unknown, name?: string) =>
    message.error?.(`${name ? `${name}: ` : ''}${t(errorKey(listeningError(error).code))}`);
  const upload = async (file: File) => {
    setUploading((count) => count + 1);
    try {
      await studioApi.upload(projectId, file);
      await mutate();
    } catch (error) {
      fail(error, file.name);
    } finally {
      setUploading((count) => count - 1);
    }
  };
  const run = async (path: string, action: () => Promise<unknown>) => {
    setBusyPath(path);
    try {
      await action();
    } catch (error) {
      fail(error);
    } finally {
      setBusyPath(undefined);
    }
  };
  const add = (item: StudioMedia) =>
    run(item.path, async () => {
      const segments = blockSegments(context.project, await studioApi.blocks(projectId, item.path));
      context.insert(segments);
      message.success?.(t('messages.studio.media.added', { count: segments.length }));
    });

  const status = (item: StudioMedia): React.ReactNode => {
    const task = importOf(item.path);
    if (isActive(task))
      return (
        <span className={styles.mediaMeta}>
          <Spin size={12} />{' '}
          {task!.totalChunks
            ? t('messages.studio.media.processing', { done: task!.completedChunks, total: task!.totalChunks })
            : t('messages.studio.media.queued')}
        </span>
      );
    if (item.blocks === undefined)
      return (
        <span className={styles.mediaMeta}>
          <Tag size='small' color='red'>
            {t('messages.studio.media.failed')}
          </Tag>{' '}
          {task?.error ? t(errorKey(task.error)) : null}
        </span>
      );
    return (
      <span className={styles.mediaMeta}>
        {t('messages.studio.media.blocks', {
          count: item.blocks,
          duration: formatTimestamp(item.durationSeconds ?? 0),
        })}
        {!item.transcribed && (
          <Tag size='small' className={styles.mediaTag}>
            {t('messages.studio.media.noTranscript')}
          </Tag>
        )}
      </span>
    );
  };

  return (
    <aside className={styles.mediaPanel} aria-label={t('messages.studio.media.title')}>
      {messageHolder}
      <div className={styles.mediaHeader}>
        <span className={styles.mediaTitle}>{t('messages.studio.media.title')}</span>
        <Space size={4}>
          <FileUpload
            multiple
            accept={ACCEPT}
            showUploadList={false}
            disabled={context.disabled}
            beforeUpload={(file) => {
              void upload(file);
              return false;
            }}
          >
            <Button size='small' type='primary' icon={<Upload />} loading={uploading > 0}>
              {t('messages.studio.media.upload')}
            </Button>
          </FileUpload>
          <Button size='small' icon={<Text />} disabled={context.disabled} onClick={() => setTextOpen(true)}>
            {t('messages.studio.media.fromText')}
          </Button>
        </Space>
      </div>
      <div className={styles.mediaList}>
        {isLoading ? (
          <Spin className={styles.mediaLoading} />
        ) : !media?.length ? (
          <Empty description={t('messages.studio.media.empty')} />
        ) : (
          media.map((item) => {
            const task = importOf(item.path);
            const ready = item.blocks !== undefined && !isActive(task);
            const busy = busyPath === item.path;
            return (
              <div key={item.path} className={styles.mediaItem}>
                <div className={styles.mediaName} title={item.name}>
                  <AudioFile className={styles.mediaIcon} />
                  <span className={styles.ellipsis}>{item.name}</span>
                </div>
                {status(item)}
                <div className={styles.mediaActions}>
                  <Button
                    size='mini'
                    type='primary'
                    icon={<Plus />}
                    disabled={!ready || context.disabled}
                    loading={busy}
                    onClick={() => void add(item)}
                  >
                    {t('messages.studio.media.add')}
                  </Button>
                  {!isActive(task) && (item.blocks === undefined || (!item.transcribed && transcriptionAvailable)) && (
                    <Button
                      size='mini'
                      disabled={busy}
                      onClick={() => void run(item.path, () => studioApi.reimport(projectId, item.path))}
                    >
                      {item.blocks === undefined ? t('common.retry') : t('messages.studio.media.transcribe')}
                    </Button>
                  )}
                  <Popconfirm
                    title={t('messages.studio.media.deleteConfirm')}
                    onOk={() =>
                      run(item.path, async () => {
                        await studioApi.removeMedia(projectId, item.path);
                        await mutate();
                      })
                    }
                  >
                    <Tooltip content={t('common.delete')}>
                      <Button size='mini' status='danger' icon={<Delete />} aria-label={t('common.delete')} />
                    </Tooltip>
                  </Popconfirm>
                </div>
              </div>
            );
          })
        )}
      </div>
      <TextImportModal
        visible={textOpen}
        projectId={projectId}
        onCancel={() => setTextOpen(false)}
        onAdd={(blocks) => {
          setTextOpen(false);
          context.insert(textSegments(context.project, blocks));
          message.success?.(t('messages.studio.media.added', { count: blocks.length }));
        }}
      />
    </aside>
  );
}
