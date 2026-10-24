import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Message, Modal, Radio, Space, Spin } from '@arco-design/web-react';
import { Redo, Undo } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { joinPath } from '@/common/chat/chatLib';
import type { ListeningSegment } from '@/common/types/platform/listeningProject';
import { localFileRef } from '@/common/types/chatFile';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { downloadFileFromRef } from '@/renderer/utils/file/download';
import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';
import { listeningApi, type ListeningError } from '@/renderer/pages/listening/data/api';
import { draft as edits, newSegment, type NewSegmentType } from '@/renderer/pages/listening/editing/draft';
import {
  deleteClipRange,
  insertSegment,
  removeSegments,
  splitClip,
} from '@/renderer/pages/listening/editing/operations';
import { useEditorShortcuts } from '@/renderer/pages/listening/editing/useEditorShortcuts';
import { PlaybackControls } from '@/renderer/pages/listening/playback/PlaybackControls';
import { usePlayer } from '@/renderer/pages/listening/playback/usePlayer';
import { Timeline } from '@/renderer/pages/listening/timeline/Timeline';
import { useZoom } from '@/renderer/pages/listening/timeline/useZoom';
import { useSelection, type ViewMode } from '@/renderer/pages/listening/editing/useSelection';
import { ClipPicker } from '@/renderer/pages/listening/layout/ClipPicker';
import { Inspector } from '@/renderer/pages/listening/layout/Inspector';
import { ProjectSettings } from '@/renderer/pages/listening/layout/ProjectSettings';
import { TransportBar } from '@/renderer/pages/listening/layout/TransportBar';
import { ScriptView } from '@/renderer/pages/listening/script/ScriptView';
import { CapabilityBanner } from '@/renderer/pages/listening/panels/CapabilityBanner';
import { TaskIssues } from '@/renderer/pages/listening/panels/RenderPanel';
import { ExportMenu } from '@/renderer/pages/listening/panels/ExportMenu';
import {
  currentTrack,
  errorKey,
  latestTask,
  isActive,
  previewState,
  generationStatus,
  ungeneratedIds,
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
  const { state: savedState, draft: project, busy } = model;
  const state = useMemo(
    () => (project && savedState ? previewState(project, savedState) : savedState),
    [project, savedState]
  );
  const rendering = !!state?.tasks.some(
    (task) => task.kind === 'track' && (task.status === 'queued' || task.status === 'running')
  );
  // Autosaves run in the background; only explicit actions (renders, previews) lock the editor.
  const disabled = busy && model.saveState !== 'saving';
  const { selection, select, selectSegment } = useSelection(project);
  const [view, setView] = useState<ViewMode>('script');
  const [picking, setPicking] = useState(false);
  const zoom = useZoom();
  const player = usePlayer(project, state, target, workspace);
  const playhead = player.time;
  const seek = player.seek;
  const issueIds = Object.entries(state?.segments ?? {})
    .filter(([, segment]) => segment.qa && segment.qa.similarity < (state?.qaThreshold ?? 1) && !segment.qa.accepted)
    .map(([id]) => id);
  const openIssues = issueIds.length;
  const current = state ? currentTrack(state, model.dirty) : undefined;
  const analysis = state ? latestTask(state.tasks, 'analysis') : undefined;
  const ttsUnavailable =
    capabilities && !capabilities.tts.available ? (capabilities.tts.reason ?? 'AUDIO_UNAVAILABLE') : undefined;
  const renderUnavailable = capabilities ? !capabilities.render.available : false;
  const generationTask = state?.tasks.find((task) => task.kind === 'segments' && isActive(task));
  const missingIds = project && state ? ungeneratedIds(project, state) : [];
  const generationStates = useMemo(
    () => (state ? generationStatus(state) : new Map<string, 'running' | 'failed'>()),
    [state]
  );

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
  /** Section and index at the segment boundary nearest the playhead (repeats count as the first play). */
  const playheadSlot = (): { sectionId: string; index: number } | undefined => {
    const entry =
      player.entries.find((item) => playhead >= item.start && playhead < item.end) ??
      (playhead >= player.duration ? player.entries.at(-1) : undefined);
    if (!entry || !project) return undefined;
    const section = project.sections.find((item) => item.id === entry.sectionId)!;
    if (!entry.segmentId) return { sectionId: section.id, index: section.segments.length };
    const position = section.segments.findIndex((s) => s.id === entry.segmentId);
    return { sectionId: section.id, index: position + (playhead > (entry.start + entry.end) / 2 ? 1 : 0) };
  };
  /** Insert after the selection; in the timeline with nothing selected, at the playhead. */
  const insertAtSelection = (segment: ListeningSegment) => {
    if (!project) return;
    const slot = selection.kind === 'none' && view === 'timeline' ? playheadSlot() : undefined;
    if (slot) {
      model.edit((current) => insertSegment(current, slot.sectionId, slot.index, segment));
      select({ kind: 'segments', sectionId: slot.sectionId, ids: [segment.id] });
      return;
    }
    const anchorId =
      selection.kind === 'segments'
        ? selection.ids[selection.ids.length - 1]
        : selection.kind === 'range'
          ? selection.clipId
          : undefined;
    const section =
      project.sections.find((item) => item.segments.some((s) => s.id === anchorId)) ??
      (selection.kind === 'section' ? project.sections.find((item) => item.id === selection.sectionId) : undefined) ??
      project.sections[0];
    const index = anchorId ? section.segments.findIndex((s) => s.id === anchorId) + 1 : section.segments.length;
    model.edit((current) => insertSegment(current, section.id, index, segment));
    select({ kind: 'segments', sectionId: section.id, ids: [segment.id] });
  };
  /** Split the clip under the playhead at the matching source time. */
  const split = () => {
    const entry = player.entries.find((item) => item.type === 'clip' && playhead >= item.start && playhead < item.end);
    if (!entry?.segmentId || !project) return;
    const clip = project.sections.flatMap((section) => section.segments).find((s) => s.id === entry.segmentId);
    if (clip?.type === 'clip')
      model.edit((current) => splitClip(current, clip.id, clip.start + playhead - entry.start));
  };
  const remove = () => {
    if (selection.kind === 'range')
      model.edit((current) => deleteClipRange(current, selection.clipId, selection.start, selection.end));
    else if (selection.kind === 'segments') model.edit((current) => removeSegments(current, selection.ids));
  };
  useEditorShortcuts({
    togglePlay: player.toggle,
    split,
    remove,
    undo: model.undo,
    redo: model.redo,
    nudge: player.nudge,
    saveNow: () => void model.flush(),
  });
  const insert = (type: NewSegmentType) => {
    if (!project) return;
    if (type === 'clip') setPicking(true);
    else insertAtSelection(newSegment(project, type));
  };
  const rowContext = {
    fileUrl,
    cacheDirectory: CACHE_DIRECTORY,
    onAddLexicon: () => addLexicon(),
    generation: {
      status: generationStates,
      disabled: disabled || !!generationTask,
      unavailable: ttsUnavailable,
      onGenerate: (id: string): void => {
        void guarded(() => model.generate([id]));
      },
    },
    replacement: {
      tasks: state?.tasks ?? [],
      revision: state?.revision ?? '',
      dirty: model.dirty,
      disabled,
      unavailable: ttsUnavailable,
      defaultVoice: project?.defaults.voice ?? 'HiuMaan',
      fileUrl,
      onPreview: async (request: Parameters<typeof model.previewReplacement>[0]) => {
        let taskId: string | undefined;
        await guarded(async () => {
          taskId = await model.previewReplacement(request);
        });
        return taskId;
      },
      onApply: (previewId: string): Promise<boolean> => model.applyReplacement(previewId),
      onCancel: (taskId: string): void => void model.cancel(taskId),
    },
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
          <span className={styles.saveState}>{t('messages.listening.player.loudnessNote')}</span>
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
            loading={!!generationTask}
            disabled={!project || disabled || !missingIds.length || !!generationTask || !!ttsUnavailable}
            onClick={() => void guarded(() => model.generate(missingIds))}
          >
            {t('messages.listening.generate.all', { count: missingIds.length })}
          </Button>
          {generationTask && (
            <Button size='small' status='danger' onClick={() => void model.cancel(generationTask.id)}>
              {t('messages.listening.generate.stop')}
            </Button>
          )}
          {state && project && (
            <ExportMenu
              summary={summarize(project, state)}
              state={state}
              dirty={model.dirty}
              current={current}
              hasOlderTrack={state.tasks.some(
                (task) => task.kind === 'track' && task.status === 'completed' && !task.previewSections?.length
              )}
              disabled={disabled}
              renderDisabled={disabled || rendering || renderUnavailable}
              onRender={() => void guarded(() => model.render())}
              openIssues={openIssues}
              firstIssue={issueIds[0]}
              fileUrl={fileUrl}
              onJump={(id) => {
                const section = project.sections.find((item) => item.segments.some((segment) => segment.id === id));
                if (section) selectSegment(section.id, id, false);
                jump(id);
              }}
              onAcceptQa={(id, accepted) => void model.acceptQa(id, accepted)}
              onBundle={async () => {
                let id: string | undefined;
                await guarded(async () => {
                  id = await model.bundle();
                });
                return id;
              }}
              onCancel={(id) => void model.cancel(id)}
              onDownload={download}
            />
          )}
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
            <Radio.Group
              type='button'
              size='small'
              value={view}
              onChange={(value: ViewMode) => setView(value)}
              options={[
                { value: 'script', label: t('messages.listening.view.script') },
                { value: 'timeline', label: t('messages.listening.view.timeline') },
              ]}
            />
            <div className={styles.body}>
              <div className={styles.main}>
                {view === 'script' ? (
                  <ScriptView
                    project={project}
                    state={state}
                    disabled={disabled}
                    focus={focus}
                    selection={selection}
                    rowContext={rowContext}
                    onEdit={model.edit}
                    onJump={jump}
                    onPreview={(sectionId) => void guarded(() => model.render([sectionId]))}
                    onAcceptQa={(segmentId, accepted) => void model.acceptQa(segmentId, accepted)}
                    onSelectSegment={selectSegment}
                  />
                ) : (
                  <Timeline
                    project={project}
                    state={state}
                    target={target}
                    selection={selection}
                    disabled={disabled}
                    pxPerSec={zoom.pxPerSec}
                    playhead={playhead}
                    flashing={player.flashing}
                    generation={rowContext.generation}
                    onSeek={seek}
                    onWheel={zoom.onWheel}
                    onSelect={select}
                    onSelectSegment={selectSegment}
                    onEdit={model.edit}
                  />
                )}
              </div>
              <Inspector
                view={view}
                selection={selection}
                project={project}
                state={state}
                disabled={disabled}
                row={{
                  ...rowContext,
                  onChange: (segment) =>
                    model.edit((current) => {
                      const section = current.sections.find((item) => item.segments.some((s) => s.id === segment.id));
                      return section ? edits.updateSegment(current, section.id, segment) : current;
                    }),
                  onSegmentMove: (sectionId, segmentId, offset) =>
                    model.edit((current) => edits.moveSegment(current, sectionId, segmentId, offset)),
                  onSegmentRemove: (sectionId, segmentId) =>
                    model.edit((current) => edits.removeSegment(current, sectionId, segmentId)),
                  onAcceptQa: (segmentId, accepted) => void model.acceptQa(segmentId, accepted),
                }}
                onDeleteRange={remove}
                onSectionChange={(sectionId, patch) =>
                  model.edit((current) => edits.updateSection(current, sectionId, patch))
                }
                projectSettings={
                  <ProjectSettings
                    project={project}
                    disabled={disabled}
                    lexiconOpen={lexiconOpen}
                    onLexiconOpen={setLexiconOpen}
                    onEdit={model.edit}
                  />
                }
              />
            </div>
            <TransportBar
              disabled={disabled}
              onInsert={insert}
              onSplit={split}
              zoom={view === 'timeline' ? zoom : undefined}
            >
              <PlaybackControls player={player} />
            </TransportBar>
            {conversation && (
              <ClipPicker
                visible={picking}
                conversationId={conversation.conversation_id}
                workspace={workspace}
                initialPath={project.sourceAudio}
                onCancel={() => setPicking(false)}
                onPick={(choice) => {
                  setPicking(false);
                  insertAtSelection({ ...newSegment(project, 'clip'), type: 'clip', ...choice } as ListeningSegment);
                }}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
