import React from 'react';
import { Alert, Button, Progress, Space } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { AudioIssue, AudioTaskView } from '@/common/types/platform/audioTools';
import { AudioPlayer } from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUIComponents/AudioPlayer';
import { formatDuration } from '@/renderer/pages/listening/editing/draft';
import { errorKey, formatTimestamp, isActive, trackFile } from '@/renderer/pages/listening/data/status';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** Problems the host reported for a task (e.g. a range the cloud service refused), with a jump link. */
export function TaskIssues({
  issues,
  onJump,
}: {
  issues?: AudioIssue[];
  onJump: (segmentId: string) => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!issues?.length) return null;
  return (
    <ul className={styles.issueList}>
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className={styles.issue}>
          <span>
            {formatTimestamp(issue.startSecond)}–{formatTimestamp(issue.endSecond)} · {t(errorKey(issue.code))}
          </span>
          {issue.segmentId && (
            <Button size='mini' type='text' onClick={() => onJump(issue.segmentId!)}>
              {t('messages.listening.actions.jump')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Progress of the newest track render (whoever started it) and the latest finished track with its QA
 * summary. A finished track that no longer matches the saved project is labelled as outdated.
 */
export function RenderPanel({
  tasks,
  current,
  openIssues,
  firstIssue,
  fileUrl,
  disabled,
  onCancel,
  onJump,
}: {
  tasks: AudioTaskView[];
  /** The full track matching the saved project, if any. */
  current?: AudioTaskView;
  /** Misread lines still awaiting a decision, computed from the current project rather than the old task. */
  openIssues: number;
  /** A misread line to reveal from the QA summary. */
  firstIssue?: string;
  fileUrl: (path: string) => string | undefined;
  disabled: boolean;
  onCancel: (taskId: string) => void;
  onJump: (segmentId: string) => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const tracks = tasks.filter((task) => task.kind === 'track');
  const latest = tracks[0];
  const finished = tracks.find((task) => task.status === 'completed');
  // The status summary already says no MP3 has been made; avoid a second banner.
  if (!latest) return null;
  const track = trackFile(finished);
  const trackUrl = track ? fileUrl(track) : undefined;
  const outdated = !!finished && !finished.previewSections?.length && finished !== current;
  const qaSkipped = finished?.warnings.includes('AUDIO_QA_SKIPPED');
  // Incomplete QA never reads as passed, even when older tasks report `qaIssues: 0`.
  const qaIncomplete = finished?.warnings.includes('AUDIO_QA_INCOMPLETE');
  return (
    <div className={styles.renderPanel}>
      {isActive(latest) && (
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
      {!isActive(latest) && latest.status !== 'completed' && (
        <Alert
          type={latest.status === 'failed' ? 'error' : 'warning'}
          content={
            <>
              {t(latest.status === 'failed' ? errorKey(latest.error) : `messages.listening.status.${latest.status}`)}
              {latest.error === 'AUDIO_CONTENT_FILTERED' && (
                <div className={styles.details}>{t('messages.listening.status.noAutoRetry')}</div>
              )}
              {latest.errorDetails?.length ? (
                <div className={styles.details}>{latest.errorDetails.join('\n')}</div>
              ) : null}
              <TaskIssues issues={latest.issues} onJump={onJump} />
            </>
          }
        />
      )}
      {finished && (
        <div className={styles.renderResult}>
          <Space size={8} wrap>
            <span className={styles.resultTitle}>
              {t(
                finished.previewSections?.length
                  ? 'messages.listening.status.preview'
                  : outdated
                    ? 'messages.listening.status.outdated'
                    : 'messages.listening.status.completed',
                { duration: formatDuration(finished.durationSeconds ?? 0) }
              )}
            </span>
            {qaIncomplete ? (
              <span className={styles.qaWarning}>{t('messages.listening.qa.incomplete')}</span>
            ) : qaSkipped || finished.qaIssues === undefined ? (
              <span className={styles.qaMuted}>
                {t(qaSkipped ? 'messages.listening.qa.skipped' : 'messages.listening.qa.notChecked')}
              </span>
            ) : (
              <span className={openIssues ? styles.qaWarning : styles.qaClean}>
                {openIssues
                  ? t('messages.listening.qa.issues', { count: openIssues })
                  : t('messages.listening.qa.clean')}
              </span>
            )}
            {!qaIncomplete && !qaSkipped && openIssues > 0 && firstIssue && (
              <Button size='mini' type='text' onClick={() => onJump(firstIssue)}>
                {t('messages.listening.actions.jump')}
              </Button>
            )}
          </Space>
          {trackUrl && <AudioPlayer url={trackUrl} />}
        </div>
      )}
    </div>
  );
}
