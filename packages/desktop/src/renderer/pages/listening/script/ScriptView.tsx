import React from 'react';
import { Button } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';
import { draft as edits } from '@/renderer/pages/listening/editing/draft';
import type { Selection } from '@/renderer/pages/listening/editing/useSelection';
import { SectionCard, type SectionCardProps } from '@/renderer/pages/listening/script/SectionCard';
import { SectionNav } from '@/renderer/pages/listening/script/SectionNav';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** The script view: sections as editable cards, one row per segment, with the shared selection highlighted. */
export function ScriptView({
  project,
  state,
  disabled,
  focus,
  selection,
  rowContext,
  onEdit,
  onJump,
  onPreview,
  onAcceptQa,
  onSelectSegment,
}: {
  project: ListeningProject;
  state: ListeningState;
  disabled: boolean;
  focus?: { id: string; nonce: number };
  selection: Selection;
  rowContext: SectionCardProps['rowContext'];
  onEdit: (change: (project: ListeningProject) => ListeningProject) => void;
  onJump: (id: string) => void;
  onPreview: (sectionId: string) => void;
  onAcceptQa: (segmentId: string, accepted: boolean) => void;
  onSelectSegment: (sectionId: string, segmentId: string, extend: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className={styles.workArea}>
      {project.sections.length > 1 && <SectionNav project={project} state={state} onJump={onJump} />}
      <div className={styles.sections}>
        {project.sections.map((section, index) => (
          <SectionCard
            key={section.id}
            section={section}
            index={index}
            count={project.sections.length}
            state={state}
            disabled={disabled}
            focus={focus}
            defaultOpen={project.sections.length === 1}
            rowContext={rowContext}
            selectedIds={
              selection.kind === 'segments' && selection.sectionId === section.id ? selection.ids : undefined
            }
            onSelectSegment={(segmentId, extend) => onSelectSegment(section.id, segmentId, extend)}
            onChange={(patch) => onEdit((current) => edits.updateSection(current, section.id, patch))}
            onMove={(offset) => onEdit((current) => edits.moveSection(current, section.id, offset))}
            onRemove={() => onEdit((current) => edits.removeSection(current, section.id))}
            onPreview={() => onPreview(section.id)}
            onAddSegment={(type) => onEdit((current) => edits.addSegment(current, section.id, type))}
            onSegmentChange={(segment) => onEdit((current) => edits.updateSegment(current, section.id, segment))}
            onSegmentMove={(segmentId, offset) =>
              onEdit((current) => edits.moveSegment(current, section.id, segmentId, offset))
            }
            onSegmentRemove={(segmentId) => onEdit((current) => edits.removeSegment(current, section.id, segmentId))}
            onAcceptQa={onAcceptQa}
          />
        ))}
        <Button type='dashed' long icon={<Plus />} disabled={disabled} onClick={() => onEdit(edits.addSection)}>
          {t('messages.listening.actions.addSection')}
        </Button>
      </div>
    </div>
  );
}
