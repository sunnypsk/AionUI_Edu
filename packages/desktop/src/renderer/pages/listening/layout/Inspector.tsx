import React from 'react';
import { Button, Input, InputNumber, Space } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ListeningProject, ListeningSection, ListeningState } from '@/common/types/platform/listeningProject';
import { formatTimestamp } from '@/renderer/pages/listening/data/status';
import type { Selection, ViewMode } from '@/renderer/pages/listening/editing/useSelection';
import { ReplacementPanel } from '@/renderer/pages/listening/script/replacement/ReplacementPanel';
import { SegmentRow, type SegmentRowProps } from '@/renderer/pages/listening/script/SegmentRow';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

export type InspectorProps = {
  view: ViewMode;
  selection: Selection;
  project: ListeningProject;
  state: ListeningState;
  disabled: boolean;
  /** Everything a segment editor needs except the per-segment callbacks, which the inspector binds. */
  row: Omit<
    SegmentRowProps,
    'segment' | 'state' | 'qaThreshold' | 'first' | 'last' | 'disabled' | 'onMove' | 'onRemove' | 'onAcceptQa'
  > & {
    onSegmentMove: (sectionId: string, segmentId: string, offset: -1 | 1) => void;
    onSegmentRemove: (sectionId: string, segmentId: string) => void;
    onAcceptQa: (segmentId: string, accepted: boolean) => void;
  };
  onSectionChange: (sectionId: string, patch: Partial<Omit<ListeningSection, 'id' | 'segments'>>) => void;
  /** Remove the selected source range from its clip. */
  onDeleteRange: () => void;
  /** Project settings, shown when nothing is selected. */
  projectSettings: React.ReactNode;
};

/** Right-hand panel: edits the selected section or segment, or the project when nothing is selected. */
export function Inspector(props: InspectorProps): React.ReactElement {
  const { t } = useTranslation();
  const { selection, project, state, disabled } = props;
  let body: React.ReactNode = props.projectSettings;
  if (selection.kind === 'section') {
    const index = project.sections.findIndex((item) => item.id === selection.sectionId);
    const section = project.sections[index];
    const number = (field: 'plays' | 'gapBetweenPlays' | 'gapAfter', min: number, max: number, precision = 0) => (
      <InputNumber
        size='small'
        aria-label={t(`messages.listening.fields.${field}`)}
        prefix={t(`messages.listening.fields.${field}`)}
        min={min}
        max={max}
        precision={precision}
        value={section[field]}
        disabled={disabled}
        onChange={(value) => props.onSectionChange(section.id, { [field]: value ?? section[field] })}
      />
    );
    body = (
      <Space direction='vertical' size={8}>
        <Input
          size='small'
          aria-label={t('messages.listening.fields.sectionLabel')}
          placeholder={t('messages.listening.fields.sectionLabelPlaceholder', { index: index + 1 })}
          value={section.label ?? ''}
          disabled={disabled}
          maxLength={200}
          onChange={(value) => props.onSectionChange(section.id, { label: value || undefined })}
        />
        {number('plays', 1, 5)}
        {section.plays > 1 && number('gapBetweenPlays', 0, 600, 1)}
        {index < project.sections.length - 1 && number('gapAfter', 0, 600, 1)}
      </Space>
    );
  } else if (selection.kind === 'segments' && selection.ids.length > 1) {
    body = <div>{t('messages.listening.inspector.multiple', { count: selection.ids.length })}</div>;
  } else if (selection.kind === 'range' && props.view === 'timeline') {
    const clip = project.sections.flatMap((section) => section.segments).find((s) => s.id === selection.clipId);
    const sourceUrl = clip?.type === 'clip' ? props.row.fileUrl(clip.path) : undefined;
    body = clip?.type === 'clip' && (
      <Space direction='vertical' size={8} style={{ width: '100%' }}>
        <div className={styles.inspectorTitle}>
          {t('messages.listening.inspector.range', {
            start: formatTimestamp(selection.start),
            end: formatTimestamp(selection.end),
          })}
        </div>
        <Button size='small' status='danger' icon={<Delete />} disabled={disabled} onClick={props.onDeleteRange}>
          {t('messages.listening.inspector.deleteRange')}
        </Button>
        {sourceUrl && (
          <ReplacementPanel
            key={`${selection.start}-${selection.end}`}
            {...props.row.replacement}
            clip={clip}
            sourceUrl={sourceUrl}
            initialMarks={{ start: selection.start, end: selection.end }}
          />
        )}
      </Space>
    );
  } else if (selection.kind === 'segments' || selection.kind === 'range') {
    const id = selection.kind === 'segments' ? selection.ids[0] : selection.clipId;
    const section = project.sections.find((item) => item.segments.some((segment) => segment.id === id))!;
    const position = section.segments.findIndex((segment) => segment.id === id);
    const segment = section.segments[position];
    const segmentState = state.segments[id];
    body =
      // The script view edits rows in place, so the inspector only summarizes them there.
      props.view === 'script' ? (
        <Space direction='vertical' size={4}>
          <div className={styles.inspectorTitle}>{t(`messages.listening.types.${segment.type}`)}</div>
          {segmentState?.duration !== undefined && <div>{formatTimestamp(segmentState.duration)}</div>}
        </Space>
      ) : (
        <SegmentRow
          {...props.row}
          segment={segment}
          state={segmentState}
          qaThreshold={state.qaThreshold}
          first={position === 0}
          last={position === section.segments.length - 1}
          disabled={disabled}
          onMove={(offset) => props.row.onSegmentMove(section.id, id, offset)}
          onRemove={() => props.row.onSegmentRemove(section.id, id)}
          onAcceptQa={(accepted) => props.row.onAcceptQa(id, accepted)}
          focusedId={id}
        />
      );
  }
  return (
    <aside className={styles.inspector} aria-label={t('messages.listening.inspector.title')}>
      {body}
    </aside>
  );
}
