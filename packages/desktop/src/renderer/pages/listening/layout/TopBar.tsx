import React from 'react';
import { Button, Input } from '@arco-design/web-react';
import { Left } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** Editor header: back to the conversation, the editable project title, and project-wide actions. */
export function TopBar({
  title,
  disabled,
  onTitleChange,
  onBack,
  children,
}: {
  title?: string;
  disabled: boolean;
  onTitleChange: (title: string) => void;
  onBack?: () => void;
  children?: React.ReactNode;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <header className={styles.topBar}>
      {onBack && (
        <Button type='text' icon={<Left />} onClick={onBack}>
          {t('messages.listening.page.back')}
        </Button>
      )}
      {title !== undefined && (
        <Input
          className={styles.titleInput}
          aria-label={t('messages.listening.fields.projectTitle')}
          placeholder={t('messages.listening.fields.projectTitle')}
          value={title}
          maxLength={200}
          disabled={disabled}
          status={title.trim() ? undefined : 'error'}
          onChange={onTitleChange}
        />
      )}
      <div className={styles.topBarActions}>{children}</div>
    </header>
  );
}
