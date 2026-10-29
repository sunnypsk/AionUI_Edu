import React, { useMemo } from 'react';
import { Alert, Button, Spin } from '@arco-design/web-react';
import { Communication } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import { listeningApi } from '@/renderer/pages/listening/data/api';
import type { EditorSource } from '@/renderer/pages/listening/data/source';
import { readCapabilities } from '@/renderer/pages/listening/data/status';
import { ListeningEditor } from '@/renderer/pages/listening/layout/ListeningEditor';
import listeningStyles from '@/renderer/pages/listening/ListeningPage.module.css';
import { studioApi } from '@/renderer/pages/studio/data/studioApi';
import { MediaPanel } from '@/renderer/pages/studio/media/MediaPanel';
import { STUDIO_PATH, type StudioChatState } from '@/renderer/pages/studio/route';

/** Start a browser download of a same-origin, cookie-authenticated URL. */
function downloadUrl(url: string, name: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Route `/audio/:projectId`: the listening editor on a studio project, with the media browser beside it. */
export default function StudioEditorPage(): React.ReactElement {
  const { t } = useTranslation();
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const { data: projects, error, isLoading, mutate } = useSWR('studio.projects', studioApi.list);
  const exists = !!projects?.some((project) => project.id === projectId);
  const source = useMemo(
    (): EditorSource | undefined =>
      exists
        ? {
            target: { project_id: projectId },
            fileUrl: (relative) => studioApi.fileUrl(projectId, relative),
            download: async (relative, name) => downloadUrl(studioApi.fileUrl(projectId, relative), name),
            studio: { projectId },
          }
        : undefined,
    [exists, projectId]
  );
  // Shares the editor's capability request through the SWR cache.
  const { data: reported } = useSWR(['edu.audio.capabilities', ''], () => listeningApi.capabilities(), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const transcriptionAvailable = !!readCapabilities(reported)?.transcription.available;
  const back = () => {
    void mutate();
    navigate(STUDIO_PATH);
  };

  if (isLoading) return <Spin className={listeningStyles.loading} />;
  if (error || !exists)
    return (
      <div className={listeningStyles.page}>
        <Alert
          type={error ? 'error' : 'warning'}
          content={t(error ? 'messages.studio.library.loadFailed' : 'messages.studio.errors.projectNotFound')}
          action={
            <Button size='mini' onClick={() => navigate(STUDIO_PATH)}>
              {t('messages.studio.editor.backToLibrary')}
            </Button>
          }
        />
      </div>
    );
  return (
    <ListeningEditor
      source={source}
      onBack={back}
      sidePanel={(context) => (
        <MediaPanel projectId={projectId} context={context} transcriptionAvailable={transcriptionAvailable} />
      )}
      headerActions={({ title, flush }) => (
        <Button
          icon={<Communication />}
          onClick={async () => {
            // The agent reads the saved project file, so pending edits are saved first.
            if (!(await flush())) return;
            const name = title?.trim() || projectId;
            const state: StudioChatState & { prefillPrompt: string; focusPrefill: boolean } = {
              studioProject: { id: projectId, title: name },
              prefillPrompt: t('messages.studio.chat.prefill', { title: name }),
              focusPrefill: true,
            };
            navigate('/guid', { state });
          }}
        >
          {t('messages.studio.chat.open')}
        </Button>
      )}
    />
  );
}
