import React from 'react';
import { Badge, Button, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';
import { formatTimestamp, sectionRange, sectionUnverified } from '@/renderer/pages/listening/data/status';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/**
 * Jump between sections. A side list on wide drawers; a Select on narrow screens (CSS switches them),
 * so long recordings with many sections stay navigable without scrolling through every clip.
 */
export function SectionNav({
  project,
  state,
  onJump,
}: {
  project: ListeningProject;
  state: ListeningState;
  onJump: (sectionId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const items = project.sections.map((section, index) => {
    const range = sectionRange(section);
    return {
      id: section.id,
      name: section.label || t('messages.listening.fields.sectionLabelPlaceholder', { index: index + 1 }),
      range: range ? `${formatTimestamp(range.start)}–${formatTimestamp(range.end)}` : undefined,
      unverified: sectionUnverified(section, state),
    };
  });
  return (
    <nav className={styles.nav} aria-label={t('messages.listening.nav.title')}>
      <Select
        className={styles.navSelect}
        size='small'
        aria-label={t('messages.listening.nav.title')}
        placeholder={t('messages.listening.nav.jump')}
        value={undefined}
        options={items.map((item) => ({
          value: item.id,
          label: item.range ? `${item.name} · ${item.range}` : item.name,
        }))}
        onChange={(id: string) => onJump(id)}
      />
      <div className={styles.navList}>
        {items.map((item) => (
          <Button
            key={item.id}
            size='small'
            type='text'
            long
            className={styles.navItem}
            onClick={() => onJump(item.id)}
          >
            <span className={styles.navName}>{item.name}</span>
            {item.range && <span className={styles.navRange}>{item.range}</span>}
            {item.unverified > 0 && (
              <Badge
                className={styles.navBadge}
                count={item.unverified}
                dotStyle={{ background: 'var(--warning)' }}
                title={t('messages.listening.section.unverified', { count: item.unverified })}
              />
            )}
          </Button>
        ))}
      </div>
    </nav>
  );
}
