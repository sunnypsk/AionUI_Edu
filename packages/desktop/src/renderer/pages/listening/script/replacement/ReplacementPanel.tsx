import React, { useState } from 'react';
import { Alert, Button, Input, Progress, Select, Space } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { AUDIO_VOICES, type AudioTaskView, type AudioVoice } from '@/common/types/platform/audioTools';
import type { ListeningSegment } from '@/common/types/platform/listeningProject';
import { AudioPlayer } from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUIComponents/AudioPlayer';
import type { ReplacementRequest } from '@/renderer/pages/listening/data/api';
import { errorKey, formatTimestamp, isActive } from '@/renderer/pages/listening/data/status';
import { RangeMarker, type RangeMarks } from './RangeMarker';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

type Clip = Extract<ListeningSegment, { type: 'clip' }>;

/** Editor-wide inputs every replacement panel shares. */
export type ReplacementContext = {
  tasks: AudioTaskView[];
  /** Saved project revision; a preview made from another revision cannot be applied. */
  revision: string;
  dirty: boolean;
  disabled: boolean;
  /** Why speech synthesis cannot run right now, as an error code; undefined when it can. */
  unavailable?: string;
  defaultVoice: AudioVoice;
  fileUrl: (path: string) => string | undefined;
  onPreview: (request: ReplacementRequest) => Promise<string | undefined>;
  onApply: (previewId: string) => Promise<boolean>;
  onCancel: (taskId: string) => void;
};

const signed = (seconds: number): string => `${seconds >= 0 ? '+' : '−'}${Math.abs(seconds).toFixed(1)}`;

/**
 * Replace a marked range of the original recording with synthesized speech in natural length.
 * The teacher hears before and after, then applies or discards; nothing changes until applied.
 */
export function ReplacementPanel({
  clip,
  sourceUrl,
  ...context
}: ReplacementContext & { clip: Clip; sourceUrl: string }): React.ReactElement {
  const { t } = useTranslation();
  const [marks, setMarks] = useState<RangeMarks>({});
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<AudioVoice>(context.defaultVoice);
  const [taskId, setTaskId] = useState<string>();
  const [starting, setStarting] = useState(false);
  const task = taskId ? context.tasks.find((item) => item.id === taskId) : undefined;
  const running = starting || (!!task && isActive(task));
  const ready = marks.start !== undefined && marks.end !== undefined && marks.end > marks.start && !!text.trim();
  const preview = task?.status === 'completed' ? task.preview : undefined;
  const stale = !!preview && (context.dirty || task?.projectRevision !== context.revision);
  const locked = context.disabled || running;

  const start = async () => {
    if (!ready || locked || context.unavailable) return;
    setStarting(true);
    try {
      setTaskId(
        await context.onPreview({ clipId: clip.id, start: marks.start!, end: marks.end!, text: text.trim(), voice })
      );
    } finally {
      setStarting(false);
    }
  };
  const discard = () => {
    if (task && isActive(task)) context.onCancel(task.id);
    setTaskId(undefined);
  };
  const apply = async () => {
    if (!taskId || !preview || stale) return;
    if (await context.onApply(taskId)) {
      setTaskId(undefined);
      setMarks({});
      setText('');
    }
  };

  return (
    <section className={styles.replacement} aria-label={t('messages.listening.replace.title')}>
      <div className={styles.replacementTitle}>{t('messages.listening.replace.title')}</div>
      <div className={styles.markHint}>{t('messages.listening.replace.disclosure')}</div>
      <RangeMarker
        url={sourceUrl}
        clipStart={clip.start}
        clipEnd={clip.end}
        marks={marks}
        disabled={locked}
        onChange={(next) => {
          setMarks(next);
          setTaskId(undefined);
        }}
      />
      <Space size={8} wrap className={styles.replacementInputs}>
        <Input
          size='small'
          className={styles.replacementText}
          aria-label={t('messages.listening.replace.text')}
          placeholder={t('messages.listening.replace.textPlaceholder')}
          value={text}
          maxLength={2000}
          disabled={locked}
          onChange={(value) => {
            setText(value);
            setTaskId(undefined);
          }}
        />
        <Select
          size='small'
          className={styles.voiceSelect}
          aria-label={t('messages.listening.fields.voice')}
          value={voice}
          disabled={locked}
          options={AUDIO_VOICES.map((item) => ({ value: item, label: t(`messages.listening.voices.${item}`) }))}
          onChange={(value: AudioVoice) => {
            setVoice(value);
            setTaskId(undefined);
          }}
        />
        <Button
          size='small'
          type='primary'
          loading={running}
          disabled={!ready || locked || !!context.unavailable}
          onClick={() => void start()}
        >
          {t('messages.listening.replace.preview')}
        </Button>
      </Space>
      {context.unavailable && <Alert type='warning' content={t(errorKey(context.unavailable))} />}
      {task && isActive(task) && (
        <div className={styles.renderProgress} role='status'>
          <span>{t('messages.listening.replace.running')}</span>
          <Progress
            size='small'
            percent={task.totalChunks ? Math.round((task.completedChunks / task.totalChunks) * 100) : 0}
          />
          <Button size='small' status='danger' onClick={() => context.onCancel(task.id)}>
            {t('messages.listening.actions.stop')}
          </Button>
        </div>
      )}
      {task && !isActive(task) && task.status !== 'completed' && (
        <Alert
          type={task.status === 'failed' ? 'error' : 'warning'}
          content={t(
            task.status === 'failed' ? errorKey(task.error) : `messages.listening.replace.status.${task.status}`
          )}
        />
      )}
      {preview && (
        <div className={styles.comparison}>
          <div className={styles.comparisonPlayers}>
            <div>
              <div className={styles.markHint}>{t('messages.listening.replace.before')}</div>
              {context.fileUrl(preview.beforePath) && (
                <AudioPlayer
                  url={context.fileUrl(preview.beforePath)!}
                  label={t('messages.listening.replace.before')}
                />
              )}
            </div>
            <div>
              <div className={styles.markHint}>{t('messages.listening.replace.after')}</div>
              {context.fileUrl(preview.afterPath) && (
                <AudioPlayer url={context.fileUrl(preview.afterPath)!} label={t('messages.listening.replace.after')} />
              )}
            </div>
          </div>
          <div role='status'>
            {t('messages.listening.replace.duration', {
              original: preview.originalSeconds.toFixed(1),
              replacement: preview.replacementSeconds.toFixed(1),
              delta: signed(preview.deltaSeconds),
            })}{' '}
            {Math.abs(preview.deltaSeconds) >= 0.05 &&
              t(
                preview.deltaSeconds > 0
                  ? 'messages.listening.replace.shiftLater'
                  : 'messages.listening.replace.shiftEarlier',
                {
                  seconds: Math.abs(preview.deltaSeconds).toFixed(1),
                  time: formatTimestamp(marks.end ?? clip.end),
                }
              )}
          </div>
          {stale && <Alert type='warning' content={t('messages.listening.replace.stale')} />}
          <Space size={8}>
            <Button type='primary' size='small' disabled={stale || context.disabled} onClick={() => void apply()}>
              {t('messages.listening.replace.apply')}
            </Button>
            <Button size='small' onClick={discard}>
              {t('messages.listening.replace.discard')}
            </Button>
          </Space>
        </div>
      )}
      {task && !preview && !isActive(task) && (
        <Button size='mini' type='text' onClick={discard}>
          {t('messages.listening.replace.discard')}
        </Button>
      )}
    </section>
  );
}
