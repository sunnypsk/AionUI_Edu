import React, { useState } from 'react';
import { Button, Popover } from '@arco-design/web-react';
import { Down } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { StatusSummary, type StatusSummaryProps } from '@/renderer/pages/listening/panels/StatusSummary';
import { RenderPanel } from '@/renderer/pages/listening/panels/RenderPanel';
import { QaPanel } from '@/renderer/pages/listening/panels/QaPanel';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** Export actions and their progress stay together, leaving the editing surface free. */
export function ExportMenu(
  props: StatusSummaryProps & {
    renderDisabled: boolean;
    openIssues: number;
    firstIssue?: string;
    fileUrl: (path: string) => string | undefined;
    onRender: () => void;
    onJump: (id: string) => void;
    onAcceptQa: (id: string, accepted: boolean) => void;
  }
): React.ReactElement {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const jump = (id: string) => {
    setVisible(false);
    props.onJump(id);
  };
  return (
    <Popover
      className={styles.exportPopover}
      trigger='click'
      position='br'
      popupVisible={visible}
      onVisibleChange={setVisible}
      content={
        <div className={styles.exportContent} role='region' aria-label={t('messages.listening.export.title')}>
          <Button type='primary' disabled={props.renderDisabled} onClick={props.onRender}>
            {t('messages.listening.actions.render')}
          </Button>
          <StatusSummary {...props} />
          <RenderPanel
            tasks={props.state.tasks}
            current={props.current}
            openIssues={props.openIssues}
            firstIssue={props.firstIssue}
            fileUrl={props.fileUrl}
            disabled={props.disabled}
            onCancel={props.onCancel}
            onJump={jump}
          />
          <QaPanel
            state={props.state}
            disabled={props.disabled || props.dirty}
            onJump={jump}
            onAccept={props.onAcceptQa}
          />
        </div>
      }
    >
      <Button icon={<Down />} disabled={props.disabled}>
        {t('messages.listening.export.title')}
      </Button>
    </Popover>
  );
}
