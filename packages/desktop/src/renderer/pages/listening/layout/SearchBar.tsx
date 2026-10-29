import React, { useMemo, useState } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { Down, Up } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ListeningProject } from '@/common/types/platform/listeningProject';
import { findSegments } from '@/renderer/pages/listening/editing/transcripts';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** Find words in speech lines and clip transcripts, stepping through matches with Enter or the arrows. */
export function SearchBar({
  project,
  onFound,
}: {
  project: ListeningProject;
  onFound: (sectionId: string, segmentId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(-1);
  const matches = useMemo(() => findSegments(project, query), [project, query]);
  const go = (offset: 1 | -1) => {
    if (!matches.length) return;
    const next = index < 0 ? (offset > 0 ? 0 : matches.length - 1) : (index + offset + matches.length) % matches.length;
    setIndex(next);
    onFound(matches[next].sectionId, matches[next].segmentId);
  };
  const shown = Math.min(index, matches.length - 1);

  return (
    <div className={styles.searchBar} role='search'>
      <Input.Search
        size='small'
        allowClear
        className={styles.searchInput}
        aria-label={t('messages.listening.search.placeholder')}
        placeholder={t('messages.listening.search.placeholder')}
        value={query}
        onChange={(value) => {
          setQuery(value);
          setIndex(-1);
        }}
        onSearch={() => go(1)}
      />
      {query.trim() && (
        <span className={styles.saveState} role='status'>
          {matches.length
            ? t('messages.listening.search.count', { index: shown + 1 || '-', total: matches.length })
            : t('messages.listening.search.none')}
        </span>
      )}
      <Button
        size='mini'
        icon={<Up />}
        aria-label={t('messages.listening.search.previous')}
        disabled={!matches.length}
        onClick={() => go(-1)}
      />
      <Button
        size='mini'
        icon={<Down />}
        aria-label={t('messages.listening.search.next')}
        disabled={!matches.length}
        onClick={() => go(1)}
      />
    </div>
  );
}
