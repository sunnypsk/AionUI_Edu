import React, { useState } from 'react';
import { Alert, Button, Empty, Input, Message, Modal, Popconfirm, Space, Spin, Tooltip } from '@arco-design/web-react';
import { Delete, Edit, Plus, Voice } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import type { StudioProject } from '@/common/types/platform/audioStudio';
import { listeningError } from '@/renderer/pages/listening/data/api';
import { errorKey } from '@/renderer/pages/listening/data/status';
import { studioApi } from '@/renderer/pages/studio/data/studioApi';
import { QuickSpeechModal } from '@/renderer/pages/studio/QuickSpeechModal';
import { studioProjectPath } from '@/renderer/pages/studio/route';
import styles from '@/renderer/pages/studio/StudioPage.module.css';

type Naming = { id?: string; title: string };

/** Route `/audio`: the user's audio studio projects, newest edit first. */
export default function StudioLibraryPage(): React.ReactElement {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [message, messageHolder] = Message.useMessage();
  const { data: projects, error, isLoading, mutate } = useSWR('studio.projects', studioApi.list);
  const [naming, setNaming] = useState<Naming>();
  const [saving, setSaving] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  const fail = (failure: unknown) => message.error?.(t(errorKey(listeningError(failure).code)));
  const submit = async () => {
    if (!naming?.title.trim()) return;
    setSaving(true);
    try {
      if (naming.id) {
        await studioApi.rename(naming.id, naming.title.trim());
        setNaming(undefined);
        await mutate();
      } else {
        const created = await studioApi.create(naming.title.trim());
        setNaming(undefined);
        await mutate();
        navigate(studioProjectPath(created.id));
      }
    } catch (failure) {
      fail(failure);
    } finally {
      setSaving(false);
    }
  };
  const remove = async (project: StudioProject) => {
    try {
      await studioApi.remove(project.id);
      await mutate();
    } catch (failure) {
      fail(failure);
    }
  };
  const open = (project: StudioProject) => navigate(studioProjectPath(project.id));

  return (
    <div className={styles.library}>
      {messageHolder}
      <header className={styles.libraryHeader}>
        <div>
          <h1 className={styles.libraryTitle}>{t('messages.studio.library.title')}</h1>
          <div className={styles.librarySubtitle}>{t('messages.studio.library.subtitle')}</div>
        </div>
        <Space size={8}>
          <Button icon={<Voice />} onClick={() => setSpeaking(true)}>
            {t('messages.studio.speech.open')}
          </Button>
          <Button
            type='primary'
            icon={<Plus />}
            onClick={() => setNaming({ title: t('messages.studio.library.defaultTitle') })}
          >
            {t('messages.studio.library.new')}
          </Button>
        </Space>
      </header>
      <QuickSpeechModal visible={speaking} onClose={() => setSpeaking(false)} />
      {isLoading ? (
        <Spin />
      ) : error ? (
        <Alert
          type='error'
          content={t('messages.studio.library.loadFailed')}
          action={
            <Button size='mini' onClick={() => void mutate()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : !projects?.length ? (
        <Empty description={t('messages.studio.library.empty')} />
      ) : (
        <div className={styles.grid}>
          {projects.map((project) => (
            <div
              key={project.id}
              className={styles.card}
              role='link'
              tabIndex={0}
              onClick={() => open(project)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') open(project);
              }}
            >
              <span className={styles.cardTitle}>{project.title || t('messages.studio.library.untitled')}</span>
              <span className={styles.cardMeta}>
                {t('messages.studio.library.blocks', { count: project.segments })} ·{' '}
                {t('messages.studio.library.updated', { time: date.format(project.updatedAt) })}
              </span>
              <div className={styles.cardActions} onClick={(event) => event.stopPropagation()}>
                <Tooltip content={t('messages.studio.library.rename')}>
                  <Button
                    size='mini'
                    type='text'
                    icon={<Edit />}
                    aria-label={t('messages.studio.library.rename')}
                    onClick={() => setNaming({ id: project.id, title: project.title })}
                  />
                </Tooltip>
                <Popconfirm title={t('messages.studio.library.deleteConfirm')} onOk={() => remove(project)}>
                  <Button size='mini' type='text' status='danger' icon={<Delete />} aria-label={t('common.delete')} />
                </Popconfirm>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal
        visible={!!naming}
        title={t(naming?.id ? 'messages.studio.library.rename' : 'messages.studio.library.new')}
        okText={t(naming?.id ? 'common.save' : 'common.create')}
        okButtonProps={{ disabled: !naming?.title.trim() }}
        confirmLoading={saving}
        onOk={() => void submit()}
        onCancel={() => setNaming(undefined)}
        unmountOnExit
      >
        <Input
          autoFocus
          aria-label={t('messages.studio.library.titleLabel')}
          placeholder={t('messages.studio.library.titleLabel')}
          maxLength={200}
          value={naming?.title ?? ''}
          onChange={(title) => setNaming((current) => (current ? { ...current, title } : current))}
          onPressEnter={() => void submit()}
        />
      </Modal>
    </div>
  );
}
