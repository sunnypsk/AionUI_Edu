import React, { useEffect, useRef, useState } from 'react';
import { Button, Collapse, Input, InputNumber, Space, Tag, Tooltip } from '@arco-design/web-react';
import { ArrowDown, ArrowUp, Delete, Down, Right } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ListeningSegment } from '@/common/types/platform/listeningProject';
import { AudioPlayer } from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUIComponents/AudioPlayer';
import {
  ReplacementPanel,
  type ReplacementContext,
} from '@/renderer/pages/listening/script/replacement/ReplacementPanel';
import { clipTranscript, clipWarnings, formatTimestamp, warningKey } from '@/renderer/pages/listening/data/status';
import type { SegmentRowProps } from './SegmentRow';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

type Clip = Extract<ListeningSegment, { type: 'clip' }>;

export type ClipRowProps = Omit<SegmentRowProps, 'segment' | 'qaThreshold' | 'onAcceptQa' | 'onAddLexicon'> & {
  segment: Clip;
  replacement: ReplacementContext;
  /** Expand and scroll to this clip, e.g. when the teacher jumps from a task issue. */
  focused: boolean;
};

/**
 * One original-recording clip. Collapsed it is a single line with its time range and transcript
 * status; expanded it shows the read-only transcript, manual range replacement and advanced fields.
 */
export function ClipRow(props: ClipRowProps): React.ReactElement {
  const { t } = useTranslation();
  const { segment, state, disabled } = props;
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const transcript = clipTranscript(segment, state);
  const warnings = clipWarnings(segment, state);
  const url = segment.path.trim() ? props.fileUrl(segment.path) : undefined;
  const invalid = !segment.path.trim() || segment.end <= segment.start;
  const range = `${formatTimestamp(segment.start)}–${formatTimestamp(segment.end)}`;

  useEffect(() => {
    if (!props.focused) return;
    setOpen(true);
    row.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [props.focused]);

  const setVerified = (verified: boolean) =>
    transcript &&
    props.onChange({
      ...segment,
      transcript: { ...transcript, verified, source: verified ? 'teacher' : transcript.source },
    });

  return (
    <div ref={row} className={styles.clip} data-segment-id={segment.id}>
      <div className={styles.clipHeader}>
        <Button
          size='mini'
          type='text'
          icon={open ? <Down /> : <Right />}
          aria-expanded={open}
          aria-label={t(open ? 'messages.listening.clip.collapse' : 'messages.listening.clip.expand', { range })}
          onClick={() => setOpen(!open)}
        />
        <Tag size='small' color='arcoblue'>
          {t('messages.listening.clip.source')}
        </Tag>
        <span className={invalid ? styles.clipRangeInvalid : styles.clipRange}>{range}</span>
        <span className={styles.clipPreview} title={transcript?.text}>
          {transcript?.text || t('messages.listening.clip.noText')}
        </span>
        {transcript?.verified ? (
          <Tag size='small' color='green'>
            {t('messages.listening.clip.verified')}
          </Tag>
        ) : (
          <Tag size='small' color='orange'>
            {t('messages.listening.clip.unverified')}
          </Tag>
        )}
        {warnings.length > 0 && (
          <Tooltip content={warnings.map((code) => t(warningKey(code))).join('\n')}>
            <Tag size='small' color='gold'>
              {t('messages.listening.clip.warnings', { count: warnings.length })}
            </Tag>
          </Tooltip>
        )}
        <div className={styles.segmentActions}>
          {url && !invalid && <AudioPlayer url={url} compact start={segment.start} end={segment.end} label={range} />}
          <Button
            size='mini'
            type='text'
            icon={<ArrowUp />}
            aria-label={t('messages.listening.actions.moveUp')}
            disabled={disabled || props.first}
            onClick={() => props.onMove(-1)}
          />
          <Button
            size='mini'
            type='text'
            icon={<ArrowDown />}
            aria-label={t('messages.listening.actions.moveDown')}
            disabled={disabled || props.last}
            onClick={() => props.onMove(1)}
          />
          <Button
            size='mini'
            type='text'
            status='danger'
            icon={<Delete />}
            aria-label={t('messages.listening.actions.delete')}
            disabled={disabled || (props.first && props.last)}
            onClick={props.onRemove}
          />
        </div>
      </div>
      {open && (
        <div className={styles.clipBody}>
          <div className={styles.transcript}>
            <div className={styles.transcriptLabel}>
              {t(
                transcript?.verified
                  ? 'messages.listening.clip.transcriptVerified'
                  : transcript?.source === 'teacher'
                    ? 'messages.listening.clip.transcriptTeacher'
                    : 'messages.listening.clip.transcriptAuto'
              )}
            </div>
            <div className={styles.transcriptText}>{transcript?.text || t('messages.listening.clip.noTextHelp')}</div>
            {transcript && (
              <Button size='mini' disabled={disabled} onClick={() => setVerified(!transcript.verified)}>
                {t(transcript.verified ? 'messages.listening.clip.unverify' : 'messages.listening.clip.verify')}
              </Button>
            )}
            {warnings.length > 0 && (
              <ul className={styles.warningList}>
                {warnings.map((code) => (
                  <li key={code}>{t(warningKey(code))}</li>
                ))}
              </ul>
            )}
          </div>
          {url && !invalid && <ReplacementPanel clip={segment} sourceUrl={url} {...props.replacement} />}
          <Collapse bordered={false} className={styles.advanced} defaultActiveKey={invalid ? ['advanced'] : []}>
            <Collapse.Item name='advanced' header={t('messages.listening.advanced.title')}>
              <Space size={8} wrap>
                <Input
                  size='small'
                  className={styles.clipPath}
                  aria-label={t('messages.listening.fields.clipPath')}
                  placeholder={t('messages.listening.fields.clipPath')}
                  value={segment.path}
                  disabled={disabled}
                  status={segment.path.trim() ? undefined : 'error'}
                  maxLength={4096}
                  onChange={(value) => props.onChange({ ...segment, path: value })}
                />
                {(['start', 'end'] as const).map((field) => (
                  <InputNumber
                    key={field}
                    size='small'
                    className={styles.secondsInput}
                    aria-label={t(`messages.listening.fields.clip${field === 'start' ? 'Start' : 'End'}`)}
                    prefix={t(`messages.listening.fields.clip${field === 'start' ? 'Start' : 'End'}`)}
                    min={0}
                    step={0.1}
                    precision={2}
                    value={segment[field]}
                    error={segment.end <= segment.start}
                    disabled={disabled}
                    onChange={(value) => props.onChange({ ...segment, [field]: value ?? segment[field] })}
                  />
                ))}
                <Input
                  size='small'
                  aria-label={t('messages.listening.fields.internalNote')}
                  placeholder={t('messages.listening.fields.internalNote')}
                  value={segment.note ?? ''}
                  disabled={disabled}
                  maxLength={200}
                  onChange={(value) => props.onChange({ ...segment, note: value || undefined })}
                />
              </Space>
            </Collapse.Item>
          </Collapse>
        </div>
      )}
    </div>
  );
}
