import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@arco-design/web-react';
import { Download } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { joinPath } from '@/common/chat/chatLib';
import { localFileRef } from '@/common/types/chatFile';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { downloadFilesAsZip } from '@/renderer/utils/file/download';
import styles from './OpenUIComponents.module.css';

type DownloadEntry = { path: string; ready: boolean };
const Registry = createContext<((id: string, entry: DownloadEntry) => () => void) | null>(null);

/** Register only rendered, validated file cards, including cards in separate OpenUI blocks. */
export function useFileDownload(path: string | null, ready: boolean): void {
  const register = useContext(Registry);
  const id = useId();
  useEffect(() => {
    if (path) return register?.(id, { path, ready });
    return undefined;
  }, [register, id, path, ready]);
}

/** Offer one archive for the files in an assistant reply, without changing the OpenUI contract. */
export function FileDownloads({ children, streaming }: { children: React.ReactNode; streaming: boolean }) {
  const { t } = useTranslation();
  const workspace = useConversationContextSafe()?.workspace;
  const [entries, setEntries] = useState<Record<string, DownloadEntry>>({});
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const register = useCallback((id: string, entry: DownloadEntry) => {
    setEntries((previous) => ({ ...previous, [id]: entry }));
    return () =>
      setEntries((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
  }, []);
  const files = [...new Set(Object.values(entries).map((entry) => entry.path))];
  const disabled = streaming || !workspace || Object.values(entries).some((entry) => !entry.ready);
  const download = async () => {
    if (disabled || !workspace || busy.current) return;
    busy.current = true;
    setLoading(true);
    setProblem(null);
    try {
      await downloadFilesAsZip(
        files.map((path) => ({ file: localFileRef(joinPath(workspace, path)), name: path })),
        t('messages.openui.file.archiveName')
      );
    } catch (error) {
      setProblem(
        error instanceof Error && error.message === 'ZIP_TOO_LARGE'
          ? 'messages.openui.file.bundleTooLarge'
          : 'messages.openui.file.downloadError'
      );
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  return (
    <Registry.Provider value={register}>
      {children}
      {files.length > 1 && (
        <div className={styles.fileDownloads}>
          <Button icon={<Download />} disabled={disabled} loading={loading} onClick={() => void download()}>
            {t('messages.openui.file.downloadAll', { count: files.length })}
          </Button>
          {problem && (
            <div className={styles.fileStatus} role='status'>
              {t(problem)}
            </div>
          )}
        </div>
      )}
    </Registry.Provider>
  );
}
