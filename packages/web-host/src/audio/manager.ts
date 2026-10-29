import { randomUUID } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, realpath, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { AudioStore } from './store.js';
import { AudioCatalog } from './providers/catalog.js';
import {
  AudioTranscriptionError,
  MultimodalTranscriber,
  type TranscriptionOptions,
  type TranscriptionResult,
} from './providers/gemini.js';
import { media, workspaceFile, type MediaServices } from './providers/media.js';
import { synthesize, type SpeechOptions } from './providers/edge.js';
import { formatTranscript, normalizeSegments } from './formats.js';
import {
  analyzeReference,
  AudioProjectError,
  detectSilences,
  generateSegments,
  renderTrack,
  trackMedia,
  type TrackMedia,
} from './track/index.js';
import { planTrack } from './track/project.js';
import { importMedia } from '../studio/importMedia.js';
import { editProject, readProjectState } from './track/editor.js';
import { previewReplacement, replaceRange, replacementClip, exportBundle } from './track/editing/index.js';
import type { AudioReplacementInput } from '../../../desktop/src/common/types/platform/audioTools.ts';
import type { ListeningProject } from '../../../desktop/src/common/types/platform/listeningProject.ts';
import {
  active,
  audioError,
  publicTask,
  TOOL_KINDS,
  toolSchemas,
  type AudioOwner,
  type AudioTask,
  type AudioToolName,
  type SpeechInput,
  type TranscribeInput,
  type TrackInput,
  type AnalysisInput,
  type StoredAudioTask,
  type AudioSegment,
} from './types.js';

type Services = {
  catalog: Pick<AudioCatalog, 'resolve'>;
  media: MediaServices;
  transcribe: (options: TranscriptionOptions) => Promise<TranscriptionResult>;
  speak: (options: SpeechOptions) => Promise<{ segments: AudioSegment[] }>;
  trackMedia: TrackMedia;
  silences: typeof detectSilences;
};
type Snapshot = {
  source?: string;
  text?: string;
  project?: ListeningProject;
  selection?: { model: string; apiKey?: string };
  model?: Awaited<ReturnType<AudioCatalog['resolve']>>;
  /** Analysis output: re-synthesized speech, or clips of the original recording. */
  mode?: 'speech' | 'clip';
};
type EditorInput = {
  project_path: string;
  revision: string;
  replacement?: AudioReplacementInput;
  segmentIds?: string[];
};
/** Studio recording import: workspace-relative media file and the project whose editor tracks the task. */
export type ImportInput = { project_path: string; media_path: string; transcribe: boolean; language: string };
type Gate = { epoch: number; open: boolean; threadId?: string; turns: Map<string, number> };
type Work = { controller: AbortController; done: Promise<void> };

/** Conversation-scoped audio jobs survive MCP waits; raw credentials stay in live closures only. */
export class AudioManager {
  readonly store: AudioStore;
  readonly ready: Promise<void>;
  private tasks: StoredAudioTask[] = [];
  private gates = new Map<string, Gate>();
  private work = new Map<string, Work>();
  private listeners = new Set<() => void>();
  private closed = false;
  private readonly services: Services;
  constructor(
    readonly dataDir: string,
    services?: Partial<Services>,
    readonly catalog = new AudioCatalog()
  ) {
    this.store = new AudioStore(dataDir);
    const transcriber = new MultimodalTranscriber();
    this.services = {
      catalog,
      media,
      transcribe: (options) => transcriber.transcribe(options),
      speak: synthesize,
      trackMedia,
      silences: detectSilences,
      ...services,
    };
    this.ready = this.store.loadTasks().then(async (tasks) => {
      this.tasks = tasks;
      for (const task of tasks)
        if (active(task)) {
          task.status = 'interrupted';
          task.error = 'AUDIO_HOST_RESTARTED';
          task.updatedAt = Date.now();
          await this.store.saveTask(task);
        }
    });
    void this.ready.catch(() => {});
  }
  private gate(owner: AudioOwner): Gate {
    const key = `${owner.userId}:${owner.conversationId}`;
    let gate = this.gates.get(key);
    if (!gate) {
      gate = { epoch: 0, open: false, turns: new Map() };
      this.gates.set(key, gate);
    }
    return gate;
  }
  /** True after this conversation's signed launcher lifecycle reached the audio gateway. */
  hasAudioRuntime(owner: AudioOwner): boolean {
    return !!this.gates.get(`${owner.userId}:${owner.conversationId}`)?.threadId;
  }
  async parentStart(owner: AudioOwner, eventId: string, threadId: string): Promise<void> {
    await this.ready;
    const gate = this.gate(owner);
    if (gate.turns.has(eventId)) return;
    gate.epoch++;
    gate.open = true;
    gate.threadId = threadId;
    gate.turns.set(eventId, gate.epoch);
    while (gate.turns.size > 256) gate.turns.delete(gate.turns.keys().next().value!);
  }
  async parentBound(owner: AudioOwner, eventId: string, turnId: string): Promise<void> {
    await this.ready;
    const gate = this.gate(owner);
    const epoch = gate.turns.get(eventId);
    if (epoch !== undefined) gate.turns.set(turnId, epoch);
  }
  async parentStop(owner: AudioOwner, threadId: string, turnId: string): Promise<void> {
    await this.ready;
    const gate = this.gate(owner);
    const epoch = gate.turns.get(turnId);
    if (gate.threadId === threadId && epoch !== undefined)
      await this.cancelConversation(owner.conversationId, epoch, owner.userId);
  }
  async epoch(conversationId: string): Promise<number> {
    await this.ready;
    return Math.max(
      0,
      ...[...this.gates].filter(([key]) => key.endsWith(`:${conversationId}`)).map(([, value]) => value.epoch)
    );
  }
  private find(owner: AudioOwner, id: string): StoredAudioTask {
    const task = this.tasks.find(
      (item) =>
        item.id === id &&
        item.owner.userId === owner.userId &&
        item.owner.conversationId === owner.conversationId &&
        item.owner.workspace === owner.workspace
    );
    if (!task) throw new Error('AUDIO_TASK_NOT_FOUND');
    return task;
  }
  /** Editor lookup: any task of this user on this workspace, whichever conversation or studio started it. */
  private findInWorkspace(owner: AudioOwner, id: string): StoredAudioTask {
    const task = this.tasks.find(
      (item) => item.id === id && item.owner.userId === owner.userId && item.owner.workspace === owner.workspace
    );
    if (!task) throw new Error('AUDIO_TASK_NOT_FOUND');
    return task;
  }
  private async persist(task: StoredAudioTask): Promise<void> {
    task.updatedAt = Date.now();
    await this.store.saveTask(structuredClone(task));
    for (const listener of this.listeners) listener();
  }
  async command(owner: AudioOwner, name: AudioToolName, input: unknown, signal: AbortSignal): Promise<AudioTask> {
    await this.ready;
    const parsed = toolSchemas[name].parse(input);
    if (parsed.action === 'start') return this.start(owner, name, parsed);
    if (!parsed.task_id) throw new Error('INVALID_REQUEST');
    const task = this.find(owner, parsed.task_id);
    if (TOOL_KINDS[name] !== task.kind) throw new Error('AUDIO_TASK_NOT_FOUND');
    if (parsed.action === 'cancel') await this.stop(task, 'cancelled');
    if (parsed.action === 'wait') {
      const deadline = Date.now() + parsed.wait_sec * 1000;
      while (active(task) && Date.now() < deadline && !signal.aborted) {
        await new Promise<void>((resolve) => {
          const done = (): void => {
            clearTimeout(timer);
            this.listeners.delete(done);
            signal.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, Math.max(0, deadline - Date.now()));
          this.listeners.add(done);
          signal.addEventListener('abort', done, { once: true });
          if (signal.aborted || !active(task)) done();
        });
      }
    }
    return publicTask(task);
  }
  /** Teacher-started render from the editor: no agent turn is needed, and agent Stop does not cancel it. */
  async startUserTrack(
    owner: AudioOwner,
    input: { project_path: string; only_sections?: string[] }
  ): Promise<AudioTask> {
    await this.ready;
    return this.start(owner, 'render_listening_track', toolSchemas.render_listening_track.parse(input), 'user');
  }
  /**
   * Recent editor jobs and the source analysis diagnostics for one project, newest first. Tasks are matched by
   * workspace rather than conversation, so a studio editor also shows renders an agent started in chat.
   */
  async listTracks(owner: AudioOwner, projectPath: string): Promise<AudioTask[]> {
    await this.ready;
    const tasks = this.tasks
      .filter(
        (task) =>
          ['track', 'replacement', 'export', 'analysis', 'segments', 'import'].includes(task.kind) &&
          task.projectPath === projectPath &&
          task.owner.userId === owner.userId &&
          task.owner.workspace === owner.workspace
      )
      .toSorted((a, b) => b.createdAt - a.createdAt);
    const recent = tasks.slice(0, 50);
    const full = tasks.find(
      (task) => task.kind === 'track' && task.status === 'completed' && !task.previewSections?.length
    );
    if (full && !recent.includes(full)) recent.push(full);
    const analysis = tasks.find((task) => task.kind === 'analysis');
    if (analysis && !recent.includes(analysis)) recent.push(analysis);
    return recent.map(publicTask);
  }
  /** Cancel a track task from the editor, whoever started it. */
  async cancelTrack(owner: AudioOwner, id: string): Promise<AudioTask> {
    await this.ready;
    const task = this.findInWorkspace(owner, id);
    if (!['track', 'replacement', 'export', 'segments', 'import'].includes(task.kind))
      throw new Error('AUDIO_TASK_NOT_FOUND');
    await this.stop(task, 'cancelled');
    return publicTask(task);
  }
  /** Start an editor-owned preview/export with the same cancellation and publication rules as renders. */
  async startEditorTask(
    owner: AudioOwner,
    kind: 'replacement' | 'export' | 'segments',
    input: EditorInput
  ): Promise<AudioTask> {
    await this.ready;
    if (this.closed) throw new Error('AUDIO_UNAVAILABLE');
    const state = await readProjectState(owner.workspace, input.project_path);
    if (state.revision !== input.revision) throw new Error('AUDIO_PROJECT_CONFLICT');
    if (!state.project) throw new AudioProjectError(state.details ?? []);
    if (kind === 'replacement') replacementClip(state.project, input.replacement!);
    const snapshot: Snapshot = { project: state.project };
    const warnings: string[] = [];
    if (kind === 'segments') {
      const segments = state.project.sections.flatMap((section) => section.segments);
      const invalid = (input.segmentIds ?? []).filter(
        (id) => segments.find((segment) => segment.id === id)?.type !== 'speech'
      );
      if (!input.segmentIds?.length || invalid.length)
        throw new AudioProjectError(invalid.map((id) => `segment_ids: ${id} is not a speech line`));
      Object.assign(snapshot, await this.qaSelection(owner, warnings));
    }
    this.assertCapacity(owner);
    return this.launch(
      {
        id: randomUUID(),
        owner: { ...owner },
        epoch: this.gate(owner).epoch,
        kind,
        status: 'queued',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        initiator: 'user',
        projectPath: input.project_path,
        projectRevision: state.revision,
        summary: state.project.title,
        ...(input.replacement ? { replacementInput: input.replacement } : {}),
        ...(kind === 'segments' ? { segmentIds: input.segmentIds } : {}),
        completedChunks: 0,
        totalChunks: 0,
        files: [],
        usage: [],
        warnings,
      },
      input,
      snapshot
    );
  }
  /**
   * Split a studio recording into contiguous blocks and transcribe each one into the recording's block sidecar.
   * Without a transcription key, or when transcription is not requested, the recording is split only.
   */
  async startImport(owner: AudioOwner, input: ImportInput): Promise<AudioTask> {
    await this.ready;
    if (this.closed) throw new Error('AUDIO_UNAVAILABLE');
    await workspaceFile(owner.workspace, input.media_path);
    const snapshot: Snapshot = {};
    const warnings: string[] = [];
    const selection = input.transcribe ? await this.store.selection(owner.userId) : undefined;
    if (selection?.apiKey) {
      try {
        Object.assign(snapshot, { selection, model: await this.services.catalog.resolve(selection.model) });
      } catch {
        warnings.push('AUDIO_ANALYSIS_TRANSCRIPT_INCOMPLETE');
      }
    }
    this.assertCapacity(owner);
    return this.launch(
      {
        id: randomUUID(),
        owner: { ...owner },
        epoch: this.gate(owner).epoch,
        kind: 'import',
        status: 'queued',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        initiator: 'user',
        model: snapshot.selection?.model,
        projectPath: input.project_path,
        sourcePath: input.media_path,
        summary: path.posix.basename(input.media_path),
        completedChunks: 0,
        totalChunks: 0,
        files: [],
        usage: [],
        warnings,
      },
      input,
      snapshot
    );
  }
  /** Register and run an editor-started task; failures are recorded on the task rather than thrown. */
  private async launch(
    task: StoredAudioTask,
    input: EditorInput | ImportInput,
    snapshot: Snapshot
  ): Promise<AudioTask> {
    const work: Work = { controller: new AbortController(), done: Promise.resolve() };
    this.tasks.push(task);
    this.work.set(task.id, work);
    await this.persist(task);
    work.done = this.execute(task, input, work.controller.signal, snapshot)
      .catch(async (error: unknown) => {
        if (active(task)) {
          task.status = 'failed';
          task.error = audioError(error);
          if (error instanceof AudioTranscriptionError) task.issues = error.issues;
          await this.persist(task);
        }
      })
      .finally(() => {
        this.work.delete(task.id);
      });
    return publicTask(task);
  }
  /** A preview id is owner-bound, completed, and tied to exactly one project revision. */
  async applyReplacement(owner: AudioOwner, projectPath: string, revision: string, previewId: string): Promise<void> {
    await this.ready;
    const task = this.findInWorkspace(owner, previewId);
    if (
      task.kind !== 'replacement' ||
      task.status !== 'completed' ||
      task.projectPath !== projectPath ||
      !task.replacementInput
    )
      throw new Error('AUDIO_REPLACEMENT_INVALID');
    if (task.projectRevision !== revision) throw new Error('AUDIO_PROJECT_CONFLICT');
    await editProject(owner.workspace, projectPath, revision, (project) =>
      replaceRange(project, task.replacementInput!)
    );
  }
  /** Decoder used for editor waveform and range previews. */
  get previewMedia(): TrackMedia {
    return this.services.trackMedia;
  }
  /** QA model for listening lines; without a key the work still runs and QA is reported as skipped. */
  private async qaSelection(owner: AudioOwner, warnings: string[]): Promise<Pick<Snapshot, 'selection' | 'model'>> {
    const selection = await this.store.selection(owner.userId);
    if (!selection.apiKey) return {};
    try {
      return { selection, model: await this.services.catalog.resolve(selection.model) };
    } catch {
      warnings.push('AUDIO_QA_INCOMPLETE');
      return {};
    }
  }
  /** Synthesis services for listening lines, with QA re-transcription when a model is selected. */
  private trackServices(task: StoredAudioTask, snapshot: Snapshot) {
    return {
      media: this.services.trackMedia,
      speak: this.services.speak,
      transcribe: snapshot.model
        ? (file: string, workDirectory: string, abort: AbortSignal) =>
            this.transcribeFile(task, snapshot, file, workDirectory, abort, {
              language: 'yue-Hant-HK',
              instructions:
                'Verbatim check of synthesized speech: write exactly the characters heard, including mispronunciations. Do not correct or paraphrase.',
            })
        : undefined,
    };
  }
  private assertCapacity(owner: AudioOwner): void {
    const activeTasks = this.tasks.filter((task) => task.owner.userId === owner.userId && active(task));
    if (
      activeTasks.length >= 4 ||
      activeTasks.filter((task) => task.owner.conversationId === owner.conversationId).length >= 2
    )
      throw new Error('AUDIO_LIMIT');
  }
  private async start(
    owner: AudioOwner,
    name: AudioToolName,
    input: TranscribeInput | SpeechInput | TrackInput | AnalysisInput,
    initiator?: 'user'
  ): Promise<AudioTask> {
    if (this.closed) throw new Error('AUDIO_UNAVAILABLE');
    let selection: Awaited<ReturnType<AudioStore['selection']>> | undefined;
    let model: Awaited<ReturnType<AudioCatalog['resolve']>> | undefined;
    let text: string | undefined;
    let source: string | undefined;
    let project: ListeningProject | undefined;
    let mode: Snapshot['mode'];
    let projectRevision: string | undefined;
    const initialWarnings: string[] = [];
    if (name === 'render_listening_track') {
      const p = input as TrackInput;
      if (!p.project_path) throw new Error('INVALID_REQUEST');
      const state = await readProjectState(owner.workspace, p.project_path);
      if (!state.project) throw new AudioProjectError(state.details ?? []);
      project = state.project;
      projectRevision = state.revision;
      planTrack(project, p.only_sections);
      if (p.verify) ({ selection, model } = await this.qaSelection(owner, initialWarnings));
    } else if (name === 'analyze_reference_audio') {
      const p = input as AnalysisInput;
      if (!p.audio_path) throw new Error('INVALID_REQUEST');
      source = await workspaceFile(owner.workspace, p.audio_path);
      selection = await this.store.selection(owner.userId);
      // Speech drafts need transcripts; without a key the draft reuses the original audio as clips.
      mode = p.mode ?? (selection.apiKey ? 'speech' : 'clip');
      if (mode === 'speech' && !selection.apiKey) throw new Error('AUDIO_KEY_REQUIRED');
      if (selection.apiKey && p.transcribe) {
        try {
          model = await this.services.catalog.resolve(selection.model);
        } catch (error) {
          if (mode === 'speech') throw error;
          initialWarnings.push('AUDIO_ANALYSIS_TRANSCRIPT_INCOMPLETE');
          selection = undefined;
        }
      } else selection = undefined;
    } else if (name === 'transcribe_audio') {
      const p = input as TranscribeInput;
      if (!p.audio_path) throw new Error('INVALID_REQUEST');
      source = await workspaceFile(owner.workspace, p.audio_path);
      selection = await this.store.selection(owner.userId);
      if (!selection.apiKey) throw new Error('AUDIO_KEY_REQUIRED');
      model = await this.services.catalog.resolve(selection.model);
    } else {
      const p = input as SpeechInput;
      if ((p.text === undefined) === (p.text_path === undefined)) throw new Error('INVALID_REQUEST');
      if (p.text_path) {
        const file = await workspaceFile(owner.workspace, p.text_path);
        const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await handle.stat();
          if (!info.isFile()) throw new Error('AUDIO_FILE_FORBIDDEN');
          if (info.size > 600000) throw new Error('AUDIO_TEXT_TOO_LARGE');
          text = new TextDecoder('utf-8', { fatal: true }).decode(await handle.readFile());
        } finally {
          await handle.close();
        }
      } else text = p.text;
      if (!text?.trim()) throw new Error('AUDIO_TEXT_REQUIRED');
      if (Buffer.byteLength(text) > 600000) throw new Error('AUDIO_TEXT_TOO_LARGE');
    }
    const gate = this.gate(owner);
    if (this.closed) throw new Error('AUDIO_UNAVAILABLE');
    if (!initiator && !gate.open) throw new Error('AUDIO_PARENT_STOPPED');
    this.assertCapacity(owner);
    const task: StoredAudioTask = {
      id: randomUUID(),
      owner: { ...owner },
      epoch: gate.epoch,
      kind: TOOL_KINDS[name],
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: selection?.model,
      ...(name === 'synthesize_speech' ? { voice: (input as SpeechInput).voice } : {}),
      ...(project
        ? {
            summary: project.title,
            projectPath: (input as TrackInput).project_path,
            projectRevision,
            ...((input as TrackInput).only_sections?.length
              ? { previewSections: (input as TrackInput).only_sections }
              : {}),
          }
        : {}),
      ...(initiator ? { initiator } : {}),
      completedChunks: 0,
      totalChunks: 0,
      files: [],
      usage: [],
      warnings: initialWarnings,
    };
    const work: Work = { controller: new AbortController(), done: Promise.resolve() };
    this.tasks.push(task);
    this.work.set(task.id, work);
    await this.persist(task);
    work.done = this.execute(task, input, work.controller.signal, { source, text, project, selection, model, mode })
      .catch(async (error: unknown) => {
        if (active(task)) {
          task.status = 'failed';
          task.error = audioError(error);
          if (error instanceof AudioTranscriptionError) task.issues = error.issues;
          if (error instanceof AudioProjectError) task.errorDetails = error.details;
          if (task.kind === 'transcription') task.warnings.push('AUDIO_COST_INCOMPLETE');
          await this.persist(task).catch(() => {});
        }
      })
      .finally(() => {
        this.work.delete(task.id);
      });
    return publicTask(task);
  }
  private async execute(
    task: StoredAudioTask,
    input: TranscribeInput | SpeechInput | TrackInput | AnalysisInput | EditorInput | ImportInput,
    signal: AbortSignal,
    snapshot: Snapshot
  ): Promise<void> {
    const workRoot = path.resolve(this.dataDir, 'audio/work');
    const directory = path.join(workRoot, task.id);
    let published: string | undefined;
    try {
      signal.throwIfAborted();
      task.status = 'running';
      await this.persist(task);
      await mkdir(workRoot, { recursive: true, mode: 0o700 });
      await mkdir(directory, { mode: 0o700 });
      let outputs: string[];
      let format: string;
      if (task.kind === 'replacement') {
        format = 'mp3';
        const result = await previewReplacement(
          {
            project: snapshot.project!,
            workspace: task.owner.workspace,
            directory,
            signal,
            services: { media: this.services.trackMedia, speak: this.services.speak },
            progress: async () => {},
          },
          task.replacementInput!
        );
        outputs = result.files;
        task.preview = {
          ...result.preview,
          beforePath: `audio/${task.id}/before.mp3`,
          afterPath: `audio/${task.id}/after.mp3`,
        };
        task.completedChunks = task.totalChunks = 1;
        task.warnings.push('AUDIO_QA_SKIPPED');
      } else if (task.kind === 'export') {
        format = 'zip';
        const full = this.tasks
          .toSorted((a, b) => b.createdAt - a.createdAt)
          .find(
            (candidate) =>
              candidate.kind === 'track' &&
              candidate.status === 'completed' &&
              !candidate.previewSections?.length &&
              candidate.projectPath === task.projectPath &&
              candidate.projectRevision === task.projectRevision &&
              candidate.owner.workspace === task.owner.workspace &&
              candidate.owner.userId === task.owner.userId &&
              candidate.owner.conversationId === task.owner.conversationId
          );
        outputs = await exportBundle({
          workspace: task.owner.workspace,
          directory,
          project: snapshot.project!,
          projectPath: task.projectPath!,
          revision: task.projectRevision!,
          files: full?.files ?? [],
          signal,
        });
        task.completedChunks = task.totalChunks = 1;
      } else if (task.kind === 'analysis') {
        const p = input as AnalysisInput;
        format = 'json';
        const result = await analyzeReference({
          workspace: task.owner.workspace,
          audioPath: p.audio_path!,
          directory,
          outputPath: `audio/${task.id}`,
          signal,
          mode: snapshot.mode!,
          title: p.title,
          noiseDb: p.noise_db,
          mergeGap: p.merge_gap,
          sectionGap: p.section_gap,
          services: {
            probe: this.services.media.probe,
            silences: this.services.silences,
            cut: this.services.media.chunk,
            transcribe: snapshot.model
              ? (file, workDirectory, abort) =>
                  this.transcribeFile(task, snapshot, file, workDirectory, abort, {
                    language: p.language,
                    instructions:
                      p.instructions ??
                      'Listening test recording: transcribe exactly what is said, in order, as plain text. Keep spoken wording; do not summarize.',
                  })
              : undefined,
          },
          progress: async (completed, total) => {
            task.completedChunks = completed;
            task.totalChunks = total;
            await this.persist(task);
          },
        });
        outputs = result.files;
        task.durationSeconds = result.durationSeconds;
        task.projectPath = result.projectPath;
        task.summary = result.summary;
        task.warnings.push(...result.warnings);
        task.issues = result.issues;
      } else if (task.kind === 'import') {
        const p = input as ImportInput;
        format = 'json';
        const result = await importMedia({
          workspace: task.owner.workspace,
          mediaPath: p.media_path,
          directory,
          signal,
          services: {
            probe: this.services.media.probe,
            silences: this.services.silences,
            cut: this.services.media.chunk,
            transcribe: snapshot.model
              ? (file, workDirectory, abort) =>
                  this.transcribeFile(task, snapshot, file, workDirectory, abort, {
                    language: p.language,
                    instructions:
                      'Transcribe exactly what is said, in order, as plain text. Keep spoken wording; do not summarize.',
                  })
              : undefined,
          },
          progress: async (completed, total) => {
            task.completedChunks = completed;
            task.totalChunks = total;
            await this.persist(task);
          },
        });
        // The block sidecar is written in place; nothing is published under audio/.
        outputs = [];
        task.durationSeconds = result.durationSeconds;
        task.warnings.push(...result.warnings);
        task.issues = result.issues;
      } else if (task.kind === 'segments') {
        format = 'mp3';
        const result = await generateSegments(
          {
            project: snapshot.project!,
            workspace: task.owner.workspace,
            directory,
            signal,
            services: this.trackServices(task, snapshot),
            progress: async (completed, total) => {
              task.completedChunks = completed;
              task.totalChunks = total;
              await this.persist(task);
            },
          },
          task.segmentIds ?? []
        );
        // Lines land in the shared segment cache; nothing is published under audio/.
        outputs = [];
        task.warnings.push(...result.warnings);
      } else if (task.kind === 'track') {
        format = 'mp3';
        const result = await renderTrack({
          project: snapshot.project!,
          onlySections: (input as TrackInput).only_sections,
          workspace: task.owner.workspace,
          directory,
          signal,
          services: this.trackServices(task, snapshot),
          progress: async (completed, total) => {
            task.completedChunks = completed;
            task.totalChunks = total;
            await this.persist(task);
          },
        });
        outputs = result.files;
        task.durationSeconds = result.durationSeconds;
        if (snapshot.model && !result.warnings.includes('AUDIO_QA_INCOMPLETE')) task.qaIssues = result.qaIssues;
        task.warnings.push(...result.warnings);
      } else if (task.kind === 'transcription') {
        const p = input as TranscribeInput;
        const source = path.join(directory, 'source.audio');
        const handle = await open(
          await workspaceFile(task.owner.workspace, p.audio_path!),
          constants.O_RDONLY | constants.O_NOFOLLOW
        );
        try {
          if (!(await handle.stat()).isFile()) throw new Error('AUDIO_FILE_FORBIDDEN');
          await pipeline(handle.createReadStream(), createWriteStream(source, { flags: 'wx', mode: 0o600 }), {
            signal,
          });
        } finally {
          await handle.close().catch(() => {});
        }
        task.durationSeconds = await this.services.media.probe(source, signal);
        task.totalChunks = Math.ceil(task.durationSeconds / 300);
        await this.persist(task);
        const result = await this.services.transcribe({
          source,
          directory,
          duration: task.durationSeconds,
          apiKey: snapshot.selection!.apiKey!,
          model: snapshot.model!,
          language: p.language,
          instructions: p.instructions,
          signal,
          progress: async (completed, total, usage) => {
            task.completedChunks = completed;
            task.totalChunks = total;
            task.usage.push(usage);
            if (task.usage.some((item) => item.costUsd !== undefined))
              task.costUsd = Number(task.usage.reduce((sum, item) => sum + (item.costUsd ?? 0), 0).toFixed(10));
            await this.persist(task);
          },
        });
        signal.throwIfAborted();
        task.issues = result.issues;
        if (result.issues?.length)
          task.warnings.push(
            'AUDIO_ANALYSIS_TRANSCRIPT_INCOMPLETE',
            ...new Set(result.issues.map((issue) => issue.code))
          );
        task.summary = result.segments
          .map((segment) => segment.text)
          .join('')
          .slice(0, 240);
        format = p.format;
        const output = path.join(directory, `transcript.${format}`);
        await writeFile(output, formatTranscript(p.format, result.segments), { flag: 'wx', mode: 0o600 });
        outputs = [output];
        task.warnings.push('AUDIO_APPROXIMATE_TIMESTAMPS');
        if (task.usage.some((usage) => usage.costUsd === undefined)) task.warnings.push('AUDIO_COST_INCOMPLETE');
      } else {
        const p = input as SpeechInput;
        task.totalChunks = 1;
        await this.persist(task);
        const output = path.join(directory, 'speech.mp3');
        outputs = [output];
        format = 'mp3';
        const result = await this.services.speak({ ...p, text: snapshot.text!, directory, output, signal });
        task.durationSeconds = await this.services.media.probe(output, signal);
        task.summary = snapshot.text!.slice(0, 240);
        if (p.subtitles) {
          const segments = normalizeSegments(result.segments, task.durationSeconds);
          if (!segments.length) throw new Error('AUDIO_SUBTITLES_UNAVAILABLE');
          const subtitle = path.join(directory, 'speech.srt');
          await writeFile(subtitle, formatTranscript('srt', segments), { flag: 'wx', mode: 0o600 });
          outputs.push(subtitle);
        }
        task.completedChunks = 1;
      }
      signal.throwIfAborted();
      if (!outputs.length) {
        task.status = 'completed';
        await this.persist(task);
        return;
      }
      const workspace = await realpath(task.owner.workspace);
      const artifacts = path.join(workspace, 'audio');
      await mkdir(artifacts, { recursive: true });
      if ((await realpath(artifacts)) !== artifacts) throw new Error('AUDIO_FILE_FORBIDDEN');
      published = path.join(artifacts, task.id);
      await mkdir(published);
      const files = outputs;
      for (const file of files) {
        signal.throwIfAborted();
        await copyFile(file, path.join(published, path.basename(file)), constants.COPYFILE_EXCL);
      }
      signal.throwIfAborted();
      task.files = files.map((file) => ({
        path: `audio/${task.id}/${path.basename(file)}`,
        format: path.extname(file).slice(1) || format,
      }));
      task.status = 'completed';
      await this.persist(task);
    } finally {
      if (published && task.status !== 'completed' && path.basename(published) === task.id)
        await rm(published, { recursive: true, force: true }).catch(() => {});
      if (path.dirname(directory) === workRoot) await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }
  /** Transcribe one short host-owned file; usage is recorded on the task but never shown to agents. */
  private async transcribeFile(
    task: StoredAudioTask,
    snapshot: Snapshot,
    source: string,
    directory: string,
    signal: AbortSignal,
    prompt: { language: string; instructions: string }
  ): Promise<string> {
    const result = await this.services.transcribe({
      source,
      directory,
      duration: await this.services.media.probe(source, signal),
      apiKey: snapshot.selection!.apiKey!,
      model: snapshot.model!,
      ...prompt,
      signal,
      progress: async (_completed, _total, usage) => {
        task.usage.push(usage);
      },
    });
    if (result.issues?.length) throw new Error(result.issues[0].code);
    return result.segments.map((segment) => segment.text).join('');
  }
  private async stop(task: StoredAudioTask, status: 'cancelled' | 'interrupted'): Promise<void> {
    if (!active(task)) return;
    task.status = status;
    task.error = status === 'interrupted' ? 'AUDIO_HOST_RESTARTED' : 'AUDIO_CANCELLED';
    this.work.get(task.id)?.controller.abort();
    await this.persist(task);
  }
  /** Agent Stop (bounded epoch) spares teacher-started renders; deleting the conversation (no epoch) cancels all. */
  async cancelConversation(conversationId: string, epoch = Number.MAX_SAFE_INTEGER, userId?: string): Promise<void> {
    await this.ready;
    for (const [key, gate] of this.gates)
      if (
        key.endsWith(`:${conversationId}`) &&
        (!userId || key === `${userId}:${conversationId}`) &&
        gate.epoch <= epoch
      )
        gate.open = false;
    await Promise.all(
      this.tasks
        .filter(
          (task) =>
            task.owner.conversationId === conversationId &&
            (!userId || task.owner.userId === userId) &&
            task.epoch <= epoch &&
            (task.initiator !== 'user' || epoch === Number.MAX_SAFE_INTEGER)
        )
        .map((task) => this.stop(task, 'cancelled'))
    );
  }
  async close(): Promise<void> {
    await this.ready;
    this.closed = true;
    await Promise.all(this.tasks.map((task) => this.stop(task, 'interrupted')));
    await Promise.allSettled([...this.work.values()].map((work) => work.done));
  }
}
