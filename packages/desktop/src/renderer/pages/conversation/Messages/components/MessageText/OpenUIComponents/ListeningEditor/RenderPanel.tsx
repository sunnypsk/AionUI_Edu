import React from 'react';
import { Alert, Button, Progress, Space } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { AudioTaskView } from '@/common/types/platform/audioTools';
import { AudioPlayer } from '../AudioPlayer';
import { formatDuration } from './draft';
import styles from './ListeningEditor.module.css';

const active = (task: AudioTaskView): boolean => task.status === 'queued' || task.status === 'running';

/** Map a host error code to an i18n key; unknown codes fall back to a generic message. */
export const ERROR_KEYS: Record<string, string> = {
  AUDIO_LIMIT: 'messages.listening.errors.limit',
  AUDIO_PROJECT_INVALID: 'messages.listening.errors.invalid',
  AUDIO_FILE_NOT_FOUND: 'messages.listening.errors.fileNotFound',
  AUDIO_DEPENDENCY_UNAVAILABLE: 'messages.listening.errors.dependency',
  AUDIO_MEDIA_FAILED: 'messages.listening.errors.media',
  AUDIO_TRACK_TOO_LONG: 'messages.listening.errors.tooLong',
  AUDIO_HOST_RESTARTED: 'messages.listening.errors.restarted',
  AUDIO_MODEL_UNSUPPORTED: 'messages.listening.errors.model',
};
export const errorKey = (code?: string): string => (code && ERROR_KEYS[code]) || 'messages.listening.errors.generic';

/**
 * Progress of the newest render (whoever started it) and the latest finished track with its QA summary.
 * Agent-started renders appear here too, so the teacher can follow and stop them.
 */
export function RenderPanel({
  tasks,
  openIssues,
  fileUrl,
  disabled,
  onCancel,
}: {
  tasks: AudioTaskView[];
  /** Misread lines still awaiting a decision, computed from the current project rather than the old task. */
  openIssues: number;
  fileUrl: (path: string) => string | undefined;
  disabled: boolean;
  onCancel: (taskId: string) => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const latest = tasks[0];
  const finished = tasks.find((task) => task.status === 'completed');
  if (!latest) return <Alert type='info' content={t('messages.listening.status.never')} />;
  const track = finished?.files.find((file) => file.path.endsWith('/track.mp3'));
  const trackUrl = track ? fileUrl(track.path) : undefined;
  return (
    <div className={styles.renderPanel}>
      {active(latest) && (
        <div className={styles.renderProgress} role='status'>
          <span>
            {t(latest.status === 'queued' ? 'messages.listening.status.queued' : 'messages.listening.status.running', {
              completed: latest.completedChunks,
              total: latest.totalChunks,
            })}
            {latest.initiator !== 'user' && ` · ${t('messages.listening.status.byAssistant')}`}
          </span>
          <Progress
            percent={latest.totalChunks ? Math.round((latest.completedChunks / latest.totalChunks) * 100) : 0}
            size='small'
          />
          <Button size='small' status='danger' disabled={disabled} onClick={() => onCancel(latest.id)}>
            {t('messages.listening.actions.stop')}
          </Button>
        </div>
      )}
      {!active(latest) && latest.status !== 'completed' && (
        <Alert
          type={latest.status === 'failed' ? 'error' : 'warning'}
          content={
            <>
              {t(latest.status === 'failed' ? errorKey(latest.error) : `messages.listening.status.${latest.status}`)}
              {latest.errorDetails?.length ? (
                <div className={styles.details}>{latest.errorDetails.join('\n')}</div>
              ) : null}
            </>
          }
        />
      )}
      {finished && (
        <div className={styles.renderResult}>
          <Space size={8} wrap>
            <span className={styles.resultTitle}>
              {t(
                finished.previewSections ? 'messages.listening.status.preview' : 'messages.listening.status.completed',
                {
                  duration: formatDuration(finished.durationSeconds ?? 0),
                }
              )}
            </span>
            {finished.qaIssues !== undefined ? (
              <span className={openIssues ? styles.qaWarning : styles.qaClean}>
                {openIssues
                  ? t('messages.listening.qa.issues', { count: openIssues })
                  : t('messages.listening.qa.clean')}
              </span>
            ) : finished.warnings.includes('AUDIO_QA_SKIPPED') ? (
              <span className={styles.qaMuted}>{t('messages.listening.qa.skipped')}</span>
            ) : null}
          </Space>
          {trackUrl && <AudioPlayer url={trackUrl} />}
        </div>
      )}
    </div>
  );
}
