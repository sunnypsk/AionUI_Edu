import React from 'react';
import { Button, Input, InputNumber, Select, Space, Tag, Tooltip } from '@arco-design/web-react';
import { ArrowDown, ArrowUp, Delete } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { AUDIO_VOICES } from '@/common/types/platform/audioTools';
import type { ListeningSegment, ListeningSegmentState } from '@/common/types/platform/listeningProject';
import { AudioPlayer } from '../AudioPlayer';
import styles from './ListeningEditor.module.css';

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
          aria-label={t('messages.listening.fields.note')}
          placeholder={t('messages.listening.fields.note')}
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
  return (
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
        onChange={(value) => onChange({ ...segment, path: value })}
      />
      {(['start', 'end'] as const).map((field) => (
        <InputNumber
          key={field}
          size='small'
          className={styles.secondsInput}
          aria-label={t(`messages.listening.fields.clip${field === 'start' ? 'Start' : 'End'}`)}
          prefix={t(`messages.listening.fields.clip${field === 'start' ? 'Start' : 'End'}`)}
          min={0}
          step={0.5}
          precision={2}
          value={segment[field]}
          error={segment.end <= segment.start}
          disabled={disabled}
          onChange={(value) => onChange({ ...segment, [field]: value ?? segment[field] })}
        />
      ))}
      <Input
        size='small'
        aria-label={t('messages.listening.fields.note')}
        placeholder={t('messages.listening.fields.note')}
        value={segment.note ?? ''}
        disabled={disabled}
        maxLength={200}
        onChange={(value) => onChange({ ...segment, note: value || undefined })}
      />
    </Space>
  );
}

/** One editable segment: type label, fields, per-line preview and QA, plus reorder/delete actions. */
export function SegmentRow(props: SegmentRowProps): React.ReactElement {
  const { t } = useTranslation();
  const { segment, state, disabled } = props;
  const url =
    segment.type === 'clip' && segment.path.trim()
      ? props.fileUrl(segment.path)
      : segment.type === 'speech' && state?.cached
        ? props.fileUrl(`${props.cacheDirectory}/${state.key}.mp3`)
        : undefined;
  return (
    <div className={styles.segment}>
      <div className={styles.segmentType}>
        <Tag size='small'>{t(`messages.listening.types.${segment.type}`)}</Tag>
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
        {url && (
          <AudioPlayer
            url={url}
            compact
            start={segment.type === 'clip' ? segment.start : undefined}
            end={segment.type === 'clip' ? segment.end : undefined}
          />
        )}
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
