import React, { useEffect, useRef } from 'react';
import { Button, Collapse, Input, InputNumber, Select, Space, Tag, Tooltip } from '@arco-design/web-react';
import { ArrowDown, ArrowUp, Delete } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { AUDIO_VOICES } from '@/common/types/platform/audioTools';
import type { ListeningSegment, ListeningSegmentState } from '@/common/types/platform/listeningProject';
import { AudioPlayer } from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUIComponents/AudioPlayer';
import type { ReplacementContext } from '@/renderer/pages/listening/script/replacement/ReplacementPanel';
import { formatTimestamp } from '@/renderer/pages/listening/data/status';
import { GenerateButton, type GenerationContext } from '@/renderer/pages/listening/panels/GenerateButton';
import { ClipRow } from './ClipRow';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** Per-clip transcription state and action shared by script rows and the inspector. */
export type TranscriptionContext = {
  /** Clip ids an active transcript task is working on. */
  running: Set<string>;
  disabled: boolean;
  /** Error code when transcription is not configured. */
  unavailable?: string;
  onTranscribe: (segmentId: string) => void;
};

export type SegmentRowProps = {
  segment: ListeningSegment;
  state?: ListeningSegmentState;
  qaThreshold: number;
  /** Stream URL for a workspace-relative path, or undefined when the workspace is unavailable. */
  fileUrl: (path: string) => string | undefined;
  cacheDirectory: string;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onChange: (segment: ListeningSegment) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
  onAcceptQa: (accepted: boolean) => void;
  onAddLexicon: () => void;
  replacement: ReplacementContext;
  generation?: GenerationContext;
  /** Re-transcription of recording clips; absent where the editor cannot transcribe. */
  transcription?: TranscriptionContext;
  /** Segment to expand and scroll to. */
  focusedId?: string;
};

/** QA badge: misread lines get accept / pronunciation-fix actions; accepted lines can be reopened. */
function QaStatus({
  state,
  qaThreshold,
  disabled,
  onAcceptQa,
  onAddLexicon,
}: Pick<SegmentRowProps, 'state' | 'qaThreshold' | 'disabled' | 'onAcceptQa' | 'onAddLexicon'>) {
  const { t } = useTranslation();
  const qa = state?.qa;
  if (!qa || qa.similarity >= qaThreshold) return null;
  if (qa.accepted)
    return (
      <Space size={4}>
        <Tag size='small' color='green'>
          {t('messages.listening.qa.accepted')}
        </Tag>
        <Button size='mini' type='text' disabled={disabled} onClick={() => onAcceptQa(false)}>
          {t('messages.listening.qa.unaccept')}
        </Button>
      </Space>
    );
  return (
    <div className={styles.qaIssue} role='status'>
      <span>{t('messages.listening.qa.heard', { text: qa.heard })}</span>
      <Space size={4} wrap>
        <Button size='mini' disabled={disabled} onClick={() => onAcceptQa(true)}>
          {t('messages.listening.qa.accept')}
        </Button>
        <Button size='mini' disabled={disabled} onClick={onAddLexicon}>
          {t('messages.listening.qa.addLexicon')}
        </Button>
      </Space>
    </div>
  );
}

function SegmentFields({ segment, disabled, onChange }: Pick<SegmentRowProps, 'segment' | 'disabled' | 'onChange'>) {
  const { t } = useTranslation();
  if (segment.type === 'speech')
    return (
      <div className={styles.speechFields}>
        <Space size={8} wrap>
          <Input
            size='small'
            className={styles.speakerInput}
            aria-label={t('messages.listening.fields.speaker')}
            placeholder={t('messages.listening.fields.speaker')}
            value={segment.speaker ?? ''}
            disabled={disabled}
            maxLength={40}
            onChange={(value) => onChange({ ...segment, speaker: value || undefined })}
          />
          <Select
            size='small'
            className={styles.voiceSelect}
            aria-label={t('messages.listening.fields.voice')}
            value={segment.voice ?? ''}
            disabled={disabled}
            options={[
              { value: '', label: t('messages.listening.fields.voiceDefault') },
              ...AUDIO_VOICES.map((voice) => ({ value: voice, label: t(`messages.listening.voices.${voice}`) })),
            ]}
            onChange={(value: string) =>
              onChange({ ...segment, voice: (value || undefined) as (typeof AUDIO_VOICES)[number] | undefined })
            }
          />
        </Space>
        <Input.TextArea
          aria-label={t('messages.listening.fields.text')}
          placeholder={t('messages.listening.fields.text')}
          value={segment.text}
          disabled={disabled}
          status={segment.text.trim() ? undefined : 'error'}
          maxLength={2000}
          autoSize={{ minRows: 1, maxRows: 8 }}
          onChange={(value) => onChange({ ...segment, text: value })}
        />
        <Collapse bordered={false} className={styles.advanced}>
          <Collapse.Item name='prosody' header={t('messages.listening.fields.voiceSettings')}>
            <Space size={8} wrap>
              {(['rate', 'volume', 'pitch'] as const).map((field) => (
                <InputNumber
                  key={field}
                  size='small'
                  className={styles.secondsInput}
                  aria-label={t(
                    field === 'rate' ? 'messages.listening.fields.defaultRate' : `messages.listening.fields.${field}`
                  )}
                  placeholder={t('messages.listening.fields.prosodyDefault')}
                  suffix={field === 'pitch' ? 'Hz' : '%'}
                  step={5}
                  precision={0}
                  disabled={disabled}
                  value={segment[field] === undefined ? undefined : Number.parseFloat(segment[field])}
                  onChange={(value) =>
                    onChange({
                      ...segment,
                      [field]:
                        value === undefined
                          ? undefined
                          : `${value >= 0 ? '+' : ''}${value}${field === 'pitch' ? 'Hz' : '%'}`,
                    })
                  }
                />
              ))}
            </Space>
          </Collapse.Item>
        </Collapse>
      </div>
    );
  if (segment.type === 'pause')
    return (
      <Space size={8} wrap>
        <InputNumber
          size='small'
          className={styles.secondsInput}
          aria-label={t('messages.listening.fields.seconds')}
          min={0.1}
          max={600}
          step={1}
          precision={1}
          suffix={t('messages.listening.fields.secondsSuffix')}
          value={segment.seconds}
          disabled={disabled}
          onChange={(value) => onChange({ ...segment, seconds: value ?? segment.seconds })}
        />
        <Input
          size='small'
          aria-label={t('messages.listening.fields.internalNote')}
          placeholder={t('messages.listening.fields.internalNote')}
          value={segment.note ?? ''}
          disabled={disabled}
          maxLength={200}
          onChange={(value) => onChange({ ...segment, note: value || undefined })}
        />
      </Space>
    );
  if (segment.type === 'chime')
    return (
      <Select
        size='small'
        className={styles.voiceSelect}
        aria-label={t('messages.listening.types.chime')}
        value={segment.preset}
        disabled={disabled}
        options={[
          { value: 'start', label: t('messages.listening.fields.chimeStart') },
          { value: 'end', label: t('messages.listening.fields.chimeEnd') },
        ]}
        onChange={(value: 'start' | 'end') => onChange({ ...segment, preset: value })}
      />
    );
  // Clips render through ClipRow.
  return null;
}

/** One editable segment: type label, fields, per-line preview and QA, plus reorder/delete actions. */
export function SegmentRow(props: SegmentRowProps): React.ReactElement {
  const { t } = useTranslation();
  const { segment, state, disabled } = props;
  const row = useRef<HTMLDivElement>(null);
  const focused = props.focusedId === segment.id;
  useEffect(() => {
    if (focused && segment.type !== 'clip') row.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [focused, segment.type]);
  if (segment.type === 'clip') return <ClipRow {...props} segment={segment} focused={props.focusedId === segment.id} />;
  const url =
    segment.type === 'speech' && state?.cached ? props.fileUrl(`${props.cacheDirectory}/${state.key}.mp3`) : undefined;
  return (
    <div ref={row} className={styles.segment} data-segment-id={segment.id}>
      <div className={styles.segmentType}>
        <Tag size='small'>{t(`messages.listening.types.${segment.type}`)}</Tag>
        {segment.type === 'speech' && segment.replaces && (
          <Tooltip content={t('messages.listening.segment.replacesTooltip')}>
            <Tag size='small' color='purple'>
              {t('messages.listening.segment.replaces', {
                range: `${formatTimestamp(segment.replaces.start)}–${formatTimestamp(segment.replaces.end)}`,
              })}
            </Tag>
          </Tooltip>
        )}
        {segment.type === 'speech' && !state?.cached && segment.text.trim() && (
          <Tooltip content={t('messages.listening.segment.notRenderedTooltip')}>
            <Tag size='small' color='gray'>
              {t('messages.listening.segment.notRendered')}
            </Tag>
          </Tooltip>
        )}
      </div>
      <div className={styles.segmentBody}>
        <SegmentFields segment={segment} disabled={disabled} onChange={props.onChange} />
        <QaStatus {...props} />
      </div>
      <div className={styles.segmentActions}>
        {segment.type === 'speech' && (
          <GenerateButton id={segment.id} generated={!!state?.cached} context={props.generation} />
        )}
        {url && <AudioPlayer url={url} compact />}
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
          // A section needs at least one segment; delete the section instead.
          disabled={disabled || (props.first && props.last)}
          onClick={props.onRemove}
        />
      </div>
    </div>
  );
}
