import React from 'react';
import { Button, Dropdown, Input, InputNumber, Menu, Space } from '@arco-design/web-react';
import { ArrowDown, ArrowUp, Delete, Plus, PreviewOpen } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ListeningSection, ListeningSegment, ListeningState } from '@/common/types/platform/listeningProject';
import type { NewSegmentType } from './draft';
import { SegmentRow, type SegmentRowProps } from './SegmentRow';
import styles from './ListeningEditor.module.css';

export type SectionCardProps = {
  section: ListeningSection;
  index: number;
  count: number;
  state: ListeningState;
  disabled: boolean;
  rowContext: Pick<SegmentRowProps, 'fileUrl' | 'cacheDirectory' | 'onAddLexicon'>;
  onChange: (patch: Partial<Omit<ListeningSection, 'id' | 'segments'>>) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
  onPreview: () => void;
  onAddSegment: (type: NewSegmentType) => void;
  onSegmentChange: (segment: ListeningSegment) => void;
  onSegmentMove: (segmentId: string, offset: -1 | 1) => void;
  onSegmentRemove: (segmentId: string) => void;
  onAcceptQa: (segmentId: string, accepted: boolean) => void;
};

const NEW_TYPES: NewSegmentType[] = ['speech', 'pause', 'chime'];

/** A section: its name, repeat and gap settings, ordered segments and a one-section preview render. */
export function SectionCard(props: SectionCardProps): React.ReactElement {
  const { t } = useTranslation();
  const { section, disabled } = props;
  const number = (field: 'plays' | 'gapBetweenPlays' | 'gapAfter', min: number, max: number, precision = 0) => (
    <InputNumber
      size='small'
      className={styles.sectionNumber}
      aria-label={t(`messages.listening.fields.${field}`)}
      prefix={t(`messages.listening.fields.${field}`)}
      min={min}
      max={max}
      precision={precision}
      value={section[field]}
      disabled={disabled}
      onChange={(value) => props.onChange({ [field]: value ?? section[field] })}
    />
  );
  return (
    <section className={styles.section} aria-label={section.label || section.id}>
      <div className={styles.sectionHeader}>
        <Input
          size='small'
          className={styles.sectionLabel}
          aria-label={t('messages.listening.fields.sectionLabel')}
          placeholder={t('messages.listening.fields.sectionLabelPlaceholder', { index: props.index + 1 })}
          value={section.label ?? ''}
          disabled={disabled}
          maxLength={200}
          onChange={(value) => props.onChange({ label: value || undefined })}
        />
        <Space size={2}>
          <Button size='mini' icon={<PreviewOpen />} disabled={disabled} onClick={props.onPreview}>
            {t('messages.listening.actions.previewSection')}
          </Button>
          <Button
            size='mini'
            type='text'
            icon={<ArrowUp />}
            aria-label={t('messages.listening.actions.moveUp')}
            disabled={disabled || props.index === 0}
            onClick={() => props.onMove(-1)}
          />
          <Button
            size='mini'
            type='text'
            icon={<ArrowDown />}
            aria-label={t('messages.listening.actions.moveDown')}
            disabled={disabled || props.index === props.count - 1}
            onClick={() => props.onMove(1)}
          />
          <Button
            size='mini'
            type='text'
            status='danger'
            icon={<Delete />}
            aria-label={t('messages.listening.actions.deleteSection')}
            disabled={disabled || props.count === 1}
            onClick={props.onRemove}
          />
        </Space>
      </div>
      <Space size={8} wrap className={styles.sectionSettings}>
        {number('plays', 1, 5)}
        {section.plays > 1 && number('gapBetweenPlays', 0, 600, 1)}
        {props.index < props.count - 1 && number('gapAfter', 0, 600, 1)}
      </Space>
      {section.segments.map((segment, position) => (
        <SegmentRow
          key={segment.id}
          {...props.rowContext}
          segment={segment}
          state={props.state.segments[segment.id]}
          qaThreshold={props.state.qaThreshold}
          first={position === 0}
          last={position === section.segments.length - 1}
          disabled={disabled}
          onChange={props.onSegmentChange}
          onMove={(offset) => props.onSegmentMove(segment.id, offset)}
          onRemove={() => props.onSegmentRemove(segment.id)}
          onAcceptQa={(accepted) => props.onAcceptQa(segment.id, accepted)}
        />
      ))}
      <Dropdown
        disabled={disabled}
        droplist={
          <Menu onClickMenuItem={(key) => props.onAddSegment(key as NewSegmentType)}>
            {NEW_TYPES.map((type) => (
              <Menu.Item key={type}>{t(`messages.listening.types.${type}`)}</Menu.Item>
            ))}
          </Menu>
        }
      >
        <Button size='small' type='dashed' long icon={<Plus />} disabled={disabled}>
          {t('messages.listening.actions.addSegment')}
        </Button>
      </Dropdown>
    </section>
  );
}
