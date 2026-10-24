import React from 'react';
import { Button, Input, Typography } from '@arco-design/web-react';
import { Delete, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ListeningProject } from '@/common/types/platform/listeningProject';
import styles from '../ListeningEditor.module.css';

type Lexicon = ListeningProject['lexicon'];

/** Pronunciation fixes: written text on the left is read aloud as the right; subtitles keep the written form. */
export function LexiconPanel({
  lexicon,
  disabled,
  onChange,
}: {
  lexicon: Lexicon;
  disabled: boolean;
  onChange: (lexicon: Lexicon) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const update = (index: number, patch: Partial<Lexicon[number]>) =>
    onChange(lexicon.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)));
  return (
    <div className={styles.lexicon}>
      <Typography.Paragraph type='secondary' className='!mb-8px'>
        {t('messages.listening.lexicon.help')}
      </Typography.Paragraph>
      {lexicon.map((entry, index) => (
        <div key={index} className={styles.lexiconRow}>
          <Input
            size='small'
            aria-label={t('messages.listening.lexicon.match')}
            placeholder={t('messages.listening.lexicon.match')}
            value={entry.match}
            maxLength={100}
            disabled={disabled}
            status={entry.match ? undefined : 'error'}
            onChange={(value) => update(index, { match: value })}
          />
          <span className={styles.lexiconArrow} aria-hidden>
            →
          </span>
          <Input
            size='small'
            aria-label={t('messages.listening.lexicon.speak')}
            placeholder={t('messages.listening.lexicon.speak')}
            value={entry.speak}
            maxLength={100}
            disabled={disabled}
            status={entry.speak ? undefined : 'error'}
            onChange={(value) => update(index, { speak: value })}
          />
          <Button
            size='mini'
            type='text'
            status='danger'
            icon={<Delete />}
            aria-label={t('messages.listening.actions.delete')}
            disabled={disabled}
            onClick={() => onChange(lexicon.filter((_, position) => position !== index))}
          />
        </div>
      ))}
      <Button
        size='small'
        type='dashed'
        icon={<Plus />}
        disabled={disabled}
        onClick={() => onChange([...lexicon, { match: '', speak: '' }])}
      >
        {t('messages.listening.lexicon.add')}
      </Button>
    </div>
  );
}
