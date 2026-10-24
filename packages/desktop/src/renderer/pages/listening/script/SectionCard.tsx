import React, { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Input, InputNumber, Menu, Space, Tag } from '@arco-design/web-react';
import { ArrowDown, ArrowUp, Delete, Down, Plus, PreviewOpen, Right } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ListeningSection, ListeningSegment, ListeningState } from '@/common/types/platform/listeningProject';
import type { NewSegmentType } from '@/renderer/pages/listening/editing/draft';
import { formatTimestamp, sectionRange, sectionUnverified } from '@/renderer/pages/listening/data/status';
import { SegmentRow, type SegmentRowProps } from './SegmentRow';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

export type SectionCardProps = {
  section: ListeningSection;
  index: number;
  count: number;
  state: ListeningState;
  disabled: boolean;
  rowContext: Pick<SegmentRowProps, 'fileUrl' | 'cacheDirectory' | 'onAddLexicon' | 'replacement' | 'generation'>;
  /** Section or segment id to reveal; a change expands this section when it matches. */
  focus?: { id: string; nonce: number };
  /** Start expanded, e.g. when the project has a single section. */
  defaultOpen?: boolean;
  onChange: (patch: Partial<Omit<ListeningSection, 'id' | 'segments'>>) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
  onPreview: () => void;
  onAddSegment: (type: NewSegmentType) => void;
  onSegmentChange: (segment: ListeningSegment) => void;
  onSegmentMove: (segmentId: string, offset: -1 | 1) => void;
  onSegmentRemove: (segmentId: string) => void;
  onAcceptQa: (segmentId: string, accepted: boolean) => void;
  /** Selected segment ids in this section, highlighted in the script. */
  selectedIds?: string[];
  onSelectSegment?: (segmentId: string, extend: boolean) => void;
};

const NEW_TYPES: NewSegmentType[] = ['speech', 'pause', 'chime', 'clip'];

/**
 * A section: collapsed to a one-line summary by default (name, original time span, items still to
 * check); expanded it shows repeat and gap settings, ordered segments and a one-section preview.
 */
export function SectionCard(props: SectionCardProps): React.ReactElement {
  const { t } = useTranslation();
  const { section, disabled, focus } = props;
  const [open, setOpen] = useState(!!props.defaultOpen);
  const card = useRef<HTMLElement>(null);
  const range = sectionRange(section);
  const unverified = sectionUnverified(section, props.state);
  const title = section.label || t('messages.listening.fields.sectionLabelPlaceholder', { index: props.index + 1 });
  const focusedSegment = focus && section.segments.some((segment) => segment.id === focus.id) ? focus.id : undefined;

  useEffect(() => {
    if (!focus || (focus.id !== section.id && !focusedSegment)) return;
    setOpen(true);
    if (focus.id === section.id) card.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to each new focus request only.
  }, [focus]);
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
    <section ref={card} className={styles.section} aria-label={title} data-section-id={section.id}>
      <div className={styles.sectionHeader}>
        <Button
          size='mini'
          type='text'
          icon={open ? <Down /> : <Right />}
          aria-expanded={open}
          aria-label={t(open ? 'messages.listening.section.collapse' : 'messages.listening.section.expand', {
            name: title,
          })}
          onClick={() => setOpen(!open)}
        />
        <div className={styles.sectionSummary}>
          <span className={styles.sectionTitle}>{title}</span>
          <span className={styles.sectionMeta}>
            {t('messages.listening.section.items', { count: section.segments.length })}
            {range && ` · ${formatTimestamp(range.start)}–${formatTimestamp(range.end)}`}
          </span>
          {unverified > 0 && (
            <Tag size='small' color='orange'>
              {t('messages.listening.section.unverified', { count: unverified })}
            </Tag>
          )}
        </div>
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
      {open && (
        <>
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
          <Space size={8} wrap className={styles.sectionSettings}>
            {number('plays', 1, 5)}
            {section.plays > 1 && number('gapBetweenPlays', 0, 600, 1)}
            {props.index < props.count - 1 && number('gapAfter', 0, 600, 1)}
          </Space>
          {section.segments.map((segment, position) => (
            <div
              key={segment.id}
              className={styles.scriptRow}
              data-script-row={segment.id}
              data-selected={props.selectedIds?.includes(segment.id) ? 'true' : 'false'}
              onClick={(event) => props.onSelectSegment?.(segment.id, event.shiftKey)}
            >
              <SegmentRow
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
                focusedId={focusedSegment}
              />
            </div>
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
        </>
      )}
    </section>
  );
}
