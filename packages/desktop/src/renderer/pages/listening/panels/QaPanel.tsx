import React from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { ListeningState } from '@/common/types/platform/listeningProject';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** Review current cached lines without treating missing or incomplete QA as a pass. */
export function QaPanel({
  state,
  disabled,
  onJump,
  onAccept,
}: {
  state: ListeningState;
  disabled: boolean;
  onJump: (id: string) => void;
  onAccept: (id: string, accepted: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const issues = Object.entries(state.segments).filter(
    ([, segment]) => segment.qa && !segment.qa.accepted && segment.qa.similarity < state.qaThreshold
  );
  const segments = state.project?.sections.flatMap((section) => section.segments) ?? [];
  return (
    <div className={styles.qaPanel}>
      <strong>{t('messages.listening.export.qa')}</strong>
      {!issues.length && <span className={styles.qaMuted}>{t('messages.listening.export.noQaIssues')}</span>}
      {issues.map(([id, segment]) => {
        const speech = segments.find((item) => item.id === id);
        return (
          <div key={id} className={styles.qaIssue}>
            <span>{speech?.type === 'speech' ? speech.text : id}</span>
            <span>{segment.qa?.heard}</span>
            <Button size='mini' onClick={() => onJump(id)}>
              {t('messages.listening.actions.jump')}
            </Button>
            <Button size='mini' disabled={disabled} onClick={() => onAccept(id, true)}>
              {t('messages.listening.qa.accept')}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
