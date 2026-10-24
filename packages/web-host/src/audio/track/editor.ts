import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { LISTENING_LIMITS } from '../../../../desktop/src/common/types/platform/listeningProject.ts';
import type {
  ListeningProject,
  ListeningSegmentState,
  ListeningState,
} from '../../../../desktop/src/common/types/platform/listeningProject.ts';
import { workspaceFile } from '../providers/media.js';
import { AudioProjectError, parseProject, parseProjectText, readProjectText, speechRequest } from './project.js';
import { SEGMENT_CACHE } from './render.js';
import { QA_THRESHOLD, qaRecordSchema, speechSimilarity, type QaRecord } from './verify.js';

export const PROJECT_SUFFIX = '.listening.json';
const revisionOf = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);
const writes = new Map<string, Promise<unknown>>();

/** Only listening project files are editable through this API; other workspace files stay agent/preview-owned. */
async function projectText(workspace: string, projectPath: string): Promise<{ file: string; text: string }> {
  if (!projectPath.endsWith(PROJECT_SUFFIX)) throw new Error('AUDIO_FILE_FORBIDDEN');
  return readProjectText(workspace, projectPath);
}

async function cached(workspace: string, name: string): Promise<string | undefined> {
  return workspaceFile(workspace, `${SEGMENT_CACHE}/${name}`).catch((): undefined => undefined);
}

async function qaRecord(workspace: string, key: string): Promise<{ file: string; record: QaRecord } | undefined> {
  const file = await cached(workspace, `${key}.qa.json`);
  if (!file) return undefined;
  const parsed = qaRecordSchema.safeParse(JSON.parse(await readFile(file, 'utf8').catch(() => 'null')));
  return parsed.success ? { file, record: parsed.data } : undefined;
}

/** Replace a file atomically in its own directory so readers and renders never see partial JSON. */
async function replace(file: string, content: string): Promise<void> {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function segmentStates(
  workspace: string,
  project: ListeningProject
): Promise<Record<string, ListeningSegmentState>> {
  const states: Record<string, ListeningSegmentState> = {};
  for (const section of project.sections)
    for (const segment of section.segments) {
      if (segment.type === 'clip') {
        states[segment.id] = {
          key: revisionOf(JSON.stringify(segment)),
          cached: true,
          transcript: segment.transcript,
          warnings: segment.warnings,
        };
        continue;
      }
      if (segment.type !== 'speech') continue;
      const request = speechRequest(project, segment);
      // Sequential on purpose: a project has at most 500 segments and each check is two small stats.
      const [audio, qa] = await Promise.all([
        cached(workspace, `${request.key}.mp3`),
        qaRecord(workspace, request.key),
      ]);
      states[segment.id] = {
        key: request.key,
        cached: !!audio,
        ...(qa
          ? {
              qa: {
                heard: qa.record.heard,
                similarity: speechSimilarity(segment.text, request.text, qa.record.heard),
                accepted: qa.record.accepted === true,
              },
            }
          : {}),
      };
    }
  return states;
}

/** Load a project for the editor; an invalid file still returns its revision and validation details. */
export async function readProjectState(workspace: string, projectPath: string): Promise<Omit<ListeningState, 'tasks'>> {
  const { text } = await projectText(workspace, projectPath);
  const base = { path: projectPath, revision: revisionOf(text), qaThreshold: QA_THRESHOLD };
  let project: ListeningProject;
  try {
    project = parseProjectText(text);
  } catch (error) {
    if (error instanceof AudioProjectError) return { ...base, details: error.details, segments: {} };
    throw error;
  }
  return { ...base, project, segments: await segmentStates(workspace, project) };
}

/** Save an edited project only if nobody (teacher or agent) changed the file since `revision` was read. */
export async function saveProject(
  workspace: string,
  projectPath: string,
  value: unknown,
  revision: string
): Promise<Omit<ListeningState, 'tasks'>> {
  return editProject(workspace, projectPath, revision, () => parseProject(value));
}

/** Serialize revision-guarded edits, including applying a completed replacement preview. */
export async function editProject(
  workspace: string,
  projectPath: string,
  revision: string,
  change: (project: ListeningProject) => ListeningProject
): Promise<Omit<ListeningState, 'tasks'>> {
  const { file } = await projectText(workspace, projectPath);
  const pending = (writes.get(file) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const current = await projectText(workspace, projectPath);
      if (revisionOf(current.text) !== revision) throw new Error('AUDIO_PROJECT_CONFLICT');
      const project = parseProject(change(parseProjectText(current.text)));
      const content = JSON.stringify(project, null, 2) + '\n';
      if (Buffer.byteLength(content) > LISTENING_LIMITS.PROJECT_BYTES) throw new Error('AUDIO_PROJECT_TOO_LARGE');
      await replace(file, content);
      return readProjectState(workspace, projectPath);
    });
  writes.set(file, pending);
  try {
    return await pending;
  } finally {
    if (writes.get(file) === pending) writes.delete(file);
  }
}

/** Record that the teacher accepts a segment's current QA reading; editing its text or voice resets this. */
export async function setQaAccepted(
  workspace: string,
  projectPath: string,
  segmentId: string,
  accepted: boolean
): Promise<Omit<ListeningState, 'tasks'>> {
  const project = parseProjectText((await projectText(workspace, projectPath)).text);
  const segment = project.sections.flatMap((section) => section.segments).find((item) => item.id === segmentId);
  if (segment?.type !== 'speech') throw new Error('INVALID_REQUEST');
  const qa = await qaRecord(workspace, speechRequest(project, segment).key);
  if (!qa) throw new Error('AUDIO_QA_NOT_FOUND');
  await replace(qa.file, JSON.stringify({ heard: qa.record.heard, ...(accepted ? { accepted: true } : {}) }));
  return readProjectState(workspace, projectPath);
}
