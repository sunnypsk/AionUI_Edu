import React, { useState } from 'react';
import { Alert, Button, Progress, Space, Tag } from '@arco-design/web-react';
import { Download } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { AudioTaskView } from '@/common/types/platform/audioTools';
import type { ListeningState } from '@/common/types/platform/listeningProject';
import { errorKey, isActive, latestTask, trackFile, type ProjectSummary } from '@/renderer/pages/listening/data/status';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

export type StatusSummaryProps = {
  summary: ProjectSummary;
  state: ListeningState;
  dirty: boolean;
  /** Full track for the saved project, if one exists. */
  current?: AudioTaskView;
  /** Whether any full-length track was ever finished, to tell "outdated" from "never made". */
  hasOlderTrack: boolean;
  disabled: boolean;
  onBundle: () => Promise<string | undefined>;
  onCancel: (taskId: string) => void;
  /** Download a workspace-relative file under the given name. */
  onDownload: (path: string, name: string) => Promise<void>;
};

const baseName = (path: string): string => path.split('/').pop() ?? path;

/**
 * What the teacher has right now: how much is original audio, what is still unchecked, whether a full
 * MP3 exists for this exact version, and the three separate downloads (MP3, portable ZIP, advanced JSON).
 */
export function StatusSummary(props: StatusSummaryProps): React.ReactElement {
  const { t } = useTranslation();
  const { summary, state, current } = props;
  const [downloading, setDownloading] = useState<string>();
  const [failed, setFailed] = useState(false);
  const exportTask = latestTask(state.tasks, 'export');
  const zip = exportTask?.files.find((file) => file.path.endsWith('.zip'))?.path;
  const zipCurrent =
    !!zip && exportTask?.status === 'completed' && !props.dirty && exportTask.projectRevision === state.revision;
  const mp3 = trackFile(current);
  const output = current ? 'ready' : props.hasOlderTrack ? 'outdated' : 'missing';

  const download = async (path: string) => {
    setDownloading(path);
    setFailed(false);
    try {
      await props.onDownload(path, baseName(path));
    } catch {
      setFailed(true);
    } finally {
      setDownloading(undefined);
    }
  };

  return (
    <div className={styles.summary} role='region' aria-label={t('messages.listening.summary.title')}>
      <div className={styles.summaryOutput}>
        <Tag color={output === 'ready' ? 'green' : output === 'outdated' ? 'orange' : 'gray'}>
          {t(`messages.listening.summary.output.${output}`)}
        </Tag>
        <span className={styles.summaryHint}>{t(`messages.listening.summary.outputHint.${output}`)}</span>
      </div>
      <div className={styles.summaryCounts}>
        <span>{t('messages.listening.summary.sourceClips', { count: summary.sourceClips })}</span>
        <span className={summary.unverified ? styles.qaWarning : undefined}>
          {t('messages.listening.summary.unverified', { count: summary.unverified })}
        </span>
        <span>{t('messages.listening.summary.verified', { count: summary.verified })}</span>
        <span>{t('messages.listening.summary.replacements', { count: summary.replacements })}</span>
        {summary.warnings > 0 && (
          <span className={styles.qaWarning}>
            {t('messages.listening.summary.warnings', { count: summary.warnings })}
          </span>
        )}
      </div>
      {summary.unverified > 0 && (
        <div className={styles.summaryHint}>{t('messages.listening.summary.unverifiedHint')}</div>
      )}
      <Space size={8} wrap>
        <Button
          size='small'
          type={mp3 ? 'primary' : 'secondary'}
          icon={<Download fill='currentColor' />}
          disabled={!mp3 || !!downloading}
          loading={!!mp3 && downloading === mp3}
          onClick={() => mp3 && void download(mp3)}
        >
          {t('messages.listening.download.mp3')}
        </Button>
        {zipCurrent ? (
          <Button
            size='small'
            icon={<Download fill='currentColor' />}
            disabled={!!downloading}
            loading={downloading === zip}
            onClick={() => void download(zip!)}
          >
            {t('messages.listening.download.zip')}
          </Button>
        ) : (
          <Button
            size='small'
            disabled={props.disabled || (!!exportTask && isActive(exportTask))}
            loading={!!exportTask && isActive(exportTask)}
            onClick={() => void props.onBundle()}
          >
            {t('messages.listening.download.prepareZip')}
          </Button>
        )}
        <Button
          size='small'
          type='text'
          icon={<Download fill='currentColor' />}
          disabled={!!downloading}
          onClick={() => void download(state.path)}
        >
          {t('messages.listening.download.json')}
        </Button>
      </Space>
      {exportTask && isActive(exportTask) && (
        <div className={styles.renderProgress} role='status'>
          <span>{t('messages.listening.download.preparing')}</span>
          <Progress
            size='small'
            percent={
              exportTask.totalChunks ? Math.round((exportTask.completedChunks / exportTask.totalChunks) * 100) : 0
            }
          />
          <Button size='small' status='danger' onClick={() => props.onCancel(exportTask.id)}>
            {t('messages.listening.actions.stop')}
          </Button>
        </div>
      )}
      {exportTask?.status === 'failed' && <Alert type='error' content={t(errorKey(exportTask.error))} />}
      {!mp3 && <div className={styles.summaryHint}>{t('messages.listening.download.mp3Unavailable')}</div>}
      {failed && (
        <div className={styles.markError} role='alert'>
          {t('messages.openui.file.downloadError')}
        </div>
      )}
    </div>
  );
}
