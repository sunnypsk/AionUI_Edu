import React, { useMemo } from 'react';
import { Alert, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { ConversationProvider, type ConversationContextValue } from '@/renderer/hooks/context/ConversationContext';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { conversationSource } from '@/renderer/pages/listening/data/source';
import { ListeningEditor } from '@/renderer/pages/listening/layout/ListeningEditor';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** Route `/conversation/:id/listening?path=…`: the full-screen editor for one listening project. */
export default function ListeningPage(): React.ReactElement {
  const { t } = useTranslation();
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const path = search.get('path') ?? '';
  const { data: conversation, isLoading } = useSWR(id ? `conversation/${id}` : null, () => getConversationOrNull(id!));
  const context = useMemo((): ConversationContextValue | undefined => {
    if (!conversation || !id) return undefined;
    const workspace = (conversation.extra as { workspace?: string } | undefined)?.workspace;
    return { conversation_id: id, workspace, type: conversation.type as ConversationContextValue['type'] };
  }, [conversation, id]);
  const source = useMemo(
    () => (context && path ? conversationSource(context.conversation_id, context.workspace, path) : undefined),
    [context, path]
  );
  const back = () => navigate(`/conversation/${encodeURIComponent(id ?? '')}`);

  if (!path)
    return (
      <div className={styles.page}>
        <Alert type='warning' content={t('messages.listening.page.missing')} />
      </div>
    );
  if (isLoading) return <Spin className={styles.loading} />;
  if (!context)
    return (
      <div className={styles.page}>
        <Alert type='error' content={t('messages.listening.page.conversationMissing')} />
      </div>
    );
  return (
    <ConversationProvider value={context}>
      <ListeningEditor source={source} onBack={back} />
    </ConversationProvider>
  );
}
