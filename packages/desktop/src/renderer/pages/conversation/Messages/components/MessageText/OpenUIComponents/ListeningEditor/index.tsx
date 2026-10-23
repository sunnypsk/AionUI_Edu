import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Collapse, Drawer, Input, Message, Modal, Select, Space, Spin } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { joinPath } from '@/common/chat/chatLib';
import { AUDIO_VOICES, type AudioVoice } from '@/common/types/platform/audioTools';
import type { ListeningProject } from '@/common/types/platform/listeningProject';
import { localFileRef } from '@/common/types/chatFile';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';
import type { ListeningError } from './api';
import { draft as edits, RATE_OPTIONS } from './draft';
import { LexiconPanel } from './LexiconPanel';
import { errorKey, RenderPanel } from './RenderPanel';
import { SectionCard } from './SectionCard';
import { useListeningProject } from './useListeningProject';
import styles from './ListeningEditor.module.css';

/** Host-side segment cache directory, mirrored from the web host's SEGMENT_CACHE. */
const CACHE_DIRECTORY = 'listening/.segments';

/** Blank speech lines or pronunciation entries the host would reject; caught before saving. */
const hasBlankFields = (project: ListeningProject): boolean =>
  project.lexicon.some((entry) => !entry.match || !entry.speak) ||
  project.sections.some((section) =>
    section.segments.some((segment) => segment.type === 'speech' && !segment.text.trim())
  );

/** Drawer editor for a `*.listening.json` project: script table, preview, render progress and QA review. */
export function ListeningEditorDrawer({
  path,
  visible,
  onClose,
}: {
  path: string;
  visible: boolean;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  // Hook-based Message/Modal render inside this tree, which React 19 requires (no ReactDOM.render).
  const [message, messageHolder] = Message.useMessage();
  const [modal, modalHolder] = Modal.useModal();
  const conversation = useConversationContextSafe();
  const workspace = conversation?.workspace;
  const target = useMemo(
    () => (visible && conversation ? { conversation_id: conversation.conversation_id, path } : undefined),
    [visible, conversation, path]
  );
  const report = useCallback(
    (error: ListeningError) =>
      message.error?.({
        content: (
          <>
            {t(errorKey(error.code))}
            {error.details.length > 0 && <div className={styles.details}>{error.details.join('\n')}</div>}
          </>
        ),
      }),
    [t, message]
  );
  const model = useListeningProject(target, report);
  const [lexiconOpen, setLexiconOpen] = useState<string[]>([]);
  const fileUrl = useCallback(
    (relative: string) => (workspace ? buildFileStreamUrl(localFileRef(joinPath(workspace, relative))) : undefined),
    [workspace]
  );
  const { state, draft: project, busy } = model;
  const rendering = !!state?.tasks.some((task) => task.status === 'queued' || task.status === 'running');
  const disabled = busy;
  const openIssues = Object.values(state?.segments ?? {}).filter(
    (segment) => segment.qa && segment.qa.similarity < (state?.qaThreshold ?? 1) && !segment.qa.accepted
  ).length;

  const guarded = async (action: () => Promise<unknown>): Promise<void> => {
    if (project && hasBlankFields(project)) {
      message.warning?.(t('messages.listening.errors.blankFields'));
      return;
    }
    await action();
  };
  const save = () =>
    guarded(async () => {
      if (await model.save()) message.success?.(t('messages.listening.saved'));
    });
  const close = () => {
    if (!model.dirty) return onClose();
    modal.confirm?.({
      title: t('messages.listening.unsaved.title'),
      content: t('messages.listening.unsaved.content'),
      okText: t('messages.listening.unsaved.discard'),
      okButtonProps: { status: 'danger' },
      onOk: () => {
        void model.reload();
        onClose();
      },
    });
  };
  const addLexicon = () => {
    model.edit((current) => edits.setLexicon(current, [...current.lexicon, { match: '', speak: '' }]));
    setLexiconOpen(['lexicon']);
  };

  return (
    <>
      {messageHolder}
      {modalHolder}
      <Drawer
        width='min(820px, 100vw)'
        title={t('messages.listening.title')}
        visible={visible}
        onCancel={close}
        unmountOnExit
        footer={
          <Space>
            <Button onClick={close}>{t('messages.listening.actions.close')}</Button>
            <Button disabled={!model.dirty || disabled} loading={busy && model.dirty} onClick={() => void save()}>
              {t('messages.listening.actions.save')}
            </Button>
            <Button
              type='primary'
              disabled={!project || disabled || rendering}
              onClick={() => void guarded(() => model.render())}
            >
              {t('messages.listening.actions.render')}
            </Button>
          </Space>
        }
      >
        {model.loadError ? (
          <Alert
            type='error'
            content={t(
              model.loadError.code === 'AUDIO_FILE_NOT_FOUND'
                ? 'messages.listening.errors.projectMissing'
                : 'messages.listening.loadFailed'
            )}
            action={
              <Button size='mini' onClick={() => void model.reload()}>
                {t('messages.listening.actions.retry')}
              </Button>
            }
          />
        ) : !state ? (
          <Spin className={styles.loading} />
        ) : !project ? (
          <Alert
            type='warning'
            title={t('messages.listening.invalid')}
            content={<div className={styles.details}>{state.details?.join('\n')}</div>}
          />
        ) : (
          <div className={styles.editor}>
            {model.conflict && (
              <Alert
                type='warning'
                content={t('messages.listening.conflict.content')}
                action={
                  <Space direction='vertical' size={4}>
                    <Button size='mini' onClick={() => void model.reload()}>
                      {t('messages.listening.conflict.reload')}
                    </Button>
                    <Button size='mini' status='warning' onClick={() => void model.save({ overwrite: true })}>
                      {t('messages.listening.conflict.overwrite')}
                    </Button>
                  </Space>
                }
              />
            )}
            <RenderPanel
              tasks={state.tasks}
              openIssues={openIssues}
              fileUrl={fileUrl}
              disabled={disabled}
              onCancel={(taskId) => void model.cancel(taskId)}
            />
            <div className={styles.projectSettings}>
              <Input
                aria-label={t('messages.listening.fields.projectTitle')}
                placeholder={t('messages.listening.fields.projectTitle')}
                value={project.title}
                maxLength={200}
                disabled={disabled}
                status={project.title.trim() ? undefined : 'error'}
                onChange={(title) => model.edit((current) => ({ ...current, title }))}
              />
              <Space size={8} wrap>
                <Select
                  size='small'
                  className={styles.defaultSelect}
                  aria-label={t('messages.listening.fields.defaultVoice')}
                  prefix={t('messages.listening.fields.defaultVoice')}
                  value={project.defaults.voice}
                  disabled={disabled}
                  options={AUDIO_VOICES.map((voice) => ({
                    value: voice,
                    label: t(`messages.listening.voices.${voice}`),
                  }))}
                  onChange={(voice: AudioVoice) =>
                    model.edit((current) => ({ ...current, defaults: { ...current.defaults, voice } }))
                  }
                />
                <Select
                  size='small'
                  className={styles.defaultSelect}
                  aria-label={t('messages.listening.fields.defaultRate')}
                  prefix={t('messages.listening.fields.defaultRate')}
                  value={project.defaults.rate}
                  disabled={disabled}
                  options={[...new Set([...RATE_OPTIONS, project.defaults.rate])].map((rate) => ({
                    value: rate,
                    label: rate === '+0%' ? t('messages.listening.fields.rateNormal') : rate,
                  }))}
                  onChange={(rate: string) =>
                    model.edit((current) => ({ ...current, defaults: { ...current.defaults, rate } }))
                  }
                />
              </Space>
            </div>
            <Collapse activeKey={lexiconOpen} onChange={(_key, keys) => setLexiconOpen(keys)} bordered={false}>
              <Collapse.Item
                name='lexicon'
                header={t('messages.listening.lexicon.title', { count: project.lexicon.length })}
              >
                <LexiconPanel
                  lexicon={project.lexicon}
                  disabled={disabled}
                  onChange={(lexicon) => model.edit((current) => edits.setLexicon(current, lexicon))}
                />
              </Collapse.Item>
            </Collapse>
            {project.sections.map((section, index) => (
              <SectionCard
                key={section.id}
                section={section}
                index={index}
                count={project.sections.length}
                state={state}
                disabled={disabled}
                rowContext={{ fileUrl, cacheDirectory: CACHE_DIRECTORY, onAddLexicon: addLexicon }}
                onChange={(patch) => model.edit((current) => edits.updateSection(current, section.id, patch))}
                onMove={(offset) => model.edit((current) => edits.moveSection(current, section.id, offset))}
                onRemove={() => model.edit((current) => edits.removeSection(current, section.id))}
                onPreview={() => void guarded(() => model.render([section.id]))}
                onAddSegment={(type) => model.edit((current) => edits.addSegment(current, section.id, type))}
                onSegmentChange={(segment) =>
                  model.edit((current) => edits.updateSegment(current, section.id, segment))
                }
                onSegmentMove={(segmentId, offset) =>
                  model.edit((current) => edits.moveSegment(current, section.id, segmentId, offset))
                }
                onSegmentRemove={(segmentId) =>
                  model.edit((current) => edits.removeSegment(current, section.id, segmentId))
                }
                onAcceptQa={(segmentId, accepted) => void model.acceptQa(segmentId, accepted)}
              />
            ))}
            <Button type='dashed' long icon={<Plus />} disabled={disabled} onClick={() => model.edit(edits.addSection)}>
              {t('messages.listening.actions.addSection')}
            </Button>
          </div>
        )}
      </Drawer>
    </>
  );
}
