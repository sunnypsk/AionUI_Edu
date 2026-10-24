import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Collapse, Message, Modal, Select, Space, Spin } from '@arco-design/web-react';
import { Plus, Redo, Undo } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { joinPath } from '@/common/chat/chatLib';
import { AUDIO_VOICES, type AudioVoice } from '@/common/types/platform/audioTools';
import type { ListeningProject } from '@/common/types/platform/listeningProject';
import { localFileRef } from '@/common/types/chatFile';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { downloadFileFromRef } from '@/renderer/utils/file/download';
import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';
import { listeningApi, type ListeningError } from '@/renderer/pages/listening/data/api';
import { draft as edits, RATE_OPTIONS } from '@/renderer/pages/listening/editing/draft';
import { CapabilityBanner } from '@/renderer/pages/listening/panels/CapabilityBanner';
import { LexiconPanel } from '@/renderer/pages/listening/panels/LexiconPanel';
import { RenderPanel, TaskIssues } from '@/renderer/pages/listening/panels/RenderPanel';
import { StatusSummary } from '@/renderer/pages/listening/panels/StatusSummary';
import { SectionCard } from '@/renderer/pages/listening/script/SectionCard';
import { SectionNav } from '@/renderer/pages/listening/script/SectionNav';
import {
  currentTrack,
  errorKey,
  latestTask,
  readCapabilities,
  summarize,
} from '@/renderer/pages/listening/data/status';
import { useProjectDraft } from '@/renderer/pages/listening/editing/useProjectDraft';
import { TopBar } from '@/renderer/pages/listening/layout/TopBar';
import { blankLine, hasBlankFields, invalidClip } from '@/renderer/pages/listening/editing/validation';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** Host-side segment cache directory, mirrored from the web host's SEGMENT_CACHE. */
const CACHE_DIRECTORY = 'listening/.segments';

/** The app uses a hash router; setting the hash also works where the editor renders outside it. */
const openToolSettings = (): void => {
  window.location.hash = '#/settings/tools';
};

/** Full-screen editor body for a `*.listening.json` project: script, preview, render progress and QA review. */
export function ListeningEditor({ path, onBack }: { path: string; onBack?: () => void }): React.ReactElement {
  const { t } = useTranslation();
  // Hook-based Message/Modal render inside this tree, which React 19 requires (no ReactDOM.render).
  const [message, messageHolder] = Message.useMessage();
  const [modal, modalHolder] = Modal.useModal();
  const conversation = useConversationContextSafe();
  const workspace = conversation?.workspace;
  const target = useMemo(
    () => (conversation ? { conversation_id: conversation.conversation_id, path } : undefined),
    [conversation, path]
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
  const model = useProjectDraft(target, report);
  const unsaved = model.saveState !== 'saved';
  useEffect(() => {
    if (!unsaved) return;
    // The browser shows its own leave-page prompt; the message text is ignored by modern browsers.
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  const [lexiconOpen, setLexiconOpen] = useState<string[]>([]);
  const fileUrl = useCallback(
    (relative: string) => (workspace ? buildFileStreamUrl(localFileRef(joinPath(workspace, relative))) : undefined),
    [workspace]
  );
  const { data: reported } = useSWR(
    target ? ['edu.audio.capabilities', target.conversation_id] : null,
    ([, conversationId]) => listeningApi.capabilities(conversationId),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const capabilities = readCapabilities(reported);
  const [focus, setFocus] = useState<{ id: string; nonce: number }>();
  const jump = useCallback((id: string) => setFocus((previous) => ({ id, nonce: (previous?.nonce ?? 0) + 1 })), []);
  const { state, draft: project, busy } = model;
  const rendering = !!state?.tasks.some(
    (task) => task.kind === 'track' && (task.status === 'queued' || task.status === 'running')
  );
  const disabled = busy;
  const issueIds = Object.entries(state?.segments ?? {})
    .filter(([, segment]) => segment.qa && segment.qa.similarity < (state?.qaThreshold ?? 1) && !segment.qa.accepted)
    .map(([id]) => id);
  const openIssues = issueIds.length;
  const current = state ? currentTrack(state, model.dirty) : undefined;
  const analysis = state ? latestTask(state.tasks, 'analysis') : undefined;
  const ttsUnavailable =
    capabilities && !capabilities.tts.available ? (capabilities.tts.reason ?? 'AUDIO_UNAVAILABLE') : undefined;
  const renderUnavailable = capabilities ? !capabilities.render.available : false;

  const guarded = async (action: () => Promise<unknown>): Promise<void> => {
    const invalid = project && invalidClip(project);
    if (invalid) {
      jump(invalid);
      message.warning?.(t('messages.listening.errors.invalid'));
      return;
    }
    if (project && hasBlankFields(project)) {
      const blank = blankLine(project);
      if (blank) jump(blank);
      message.warning?.(t('messages.listening.errors.blankFields'));
      return;
    }
    await action();
  };
  const download = async (relative: string, name: string) => {
    if (!workspace) throw new Error('workspace unavailable');
    await downloadFileFromRef(localFileRef(joinPath(workspace, relative)), name);
  };
  const save = () =>
    guarded(async () => {
      if (await model.save()) message.success?.(t('messages.listening.saved'));
    });
  const close = async (then?: () => void) => {
    const leave = () => {
      onBack?.();
      then?.();
    };
    // Save what the autosave has not reached yet; ask only when that fails.
    if (await model.flush()) return leave();
    modal.confirm?.({
      title: t('messages.listening.unsaved.title'),
      content: t('messages.listening.unsaved.content'),
      okText: t('messages.listening.unsaved.discard'),
      okButtonProps: { status: 'danger' },
      onOk: () => {
        void model.reload();
        leave();
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
      <div className={styles.page}>
        <TopBar
          title={project?.title}
          disabled={disabled}
          onTitleChange={(title) => model.edit((current) => ({ ...current, title }))}
          onBack={onBack ? () => void close() : undefined}
        >
          <span className={styles.saveState} role='status'>
            {t(`messages.listening.save.${model.saveState}`)}
          </span>
          <Button
            disabled={!model.canUndo || disabled}
            aria-label={t('messages.listening.actions.undo')}
            icon={<Undo />}
            onClick={model.undo}
          />
          <Button
            disabled={!model.canRedo || disabled}
            aria-label={t('messages.listening.actions.redo')}
            icon={<Redo />}
            onClick={model.redo}
          />
          <Button disabled={!model.dirty || disabled} loading={busy && model.dirty} onClick={() => void save()}>
            {t('messages.listening.actions.save')}
          </Button>
          <Button
            type='primary'
            disabled={!project || disabled || rendering || renderUnavailable}
            onClick={() => void guarded(() => model.render())}
          >
            {t('messages.listening.actions.render')}
          </Button>
        </TopBar>
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
            <CapabilityBanner capabilities={capabilities} onOpenSettings={() => void close(openToolSettings)} />
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
            <StatusSummary
              summary={summarize(project, state)}
              state={state}
              dirty={model.dirty}
              current={current}
              hasOlderTrack={state.tasks.some(
                (task) => task.kind === 'track' && task.status === 'completed' && !task.previewSections?.length
              )}
              disabled={disabled}
              onBundle={async () => {
                let taskId: string | undefined;
                await guarded(async () => {
                  taskId = await model.bundle();
                });
                return taskId;
              }}
              onCancel={(taskId) => void model.cancel(taskId)}
              onDownload={download}
            />
            {analysis?.issues?.length ? (
              <Alert
                type='warning'
                title={t('messages.listening.analysis.blockedTitle')}
                content={
                  <>
                    {t('messages.listening.analysis.blocked')}
                    <TaskIssues issues={analysis.issues} onJump={jump} />
                  </>
                }
              />
            ) : null}
            <RenderPanel
              tasks={state.tasks}
              current={current}
              openIssues={openIssues}
              firstIssue={issueIds[0]}
              fileUrl={fileUrl}
              disabled={disabled}
              onCancel={(taskId) => void model.cancel(taskId)}
              onJump={jump}
            />
            <div className={styles.projectSettings}>
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
            <div className={styles.workArea}>
              {project.sections.length > 1 && <SectionNav project={project} state={state} onJump={jump} />}
              <div className={styles.sections}>
                {project.sections.map((section, index) => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    index={index}
                    count={project.sections.length}
                    state={state}
                    disabled={disabled}
                    focus={focus}
                    defaultOpen={project.sections.length === 1}
                    rowContext={{
                      fileUrl,
                      cacheDirectory: CACHE_DIRECTORY,
                      onAddLexicon: addLexicon,
                      replacement: {
                        tasks: state.tasks,
                        revision: state.revision,
                        dirty: model.dirty,
                        disabled,
                        unavailable: ttsUnavailable,
                        defaultVoice: project.defaults.voice,
                        fileUrl,
                        onPreview: async (request) => {
                          let taskId: string | undefined;
                          await guarded(async () => {
                            taskId = await model.previewReplacement(request);
                          });
                          return taskId;
                        },
                        onApply: (previewId) => model.applyReplacement(previewId),
                        onCancel: (taskId) => void model.cancel(taskId),
                      },
                    }}
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
                <Button
                  type='dashed'
                  long
                  icon={<Plus />}
                  disabled={disabled}
                  onClick={() => model.edit(edits.addSection)}
                >
                  {t('messages.listening.actions.addSection')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
