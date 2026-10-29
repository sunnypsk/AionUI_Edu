import { BackendHttpError, getBaseUrl, httpRequest, resolveCoreCsrfToken } from '@/common/adapter/httpBridge';
import type {
  QuickSpeechInput,
  StudioMedia,
  StudioMediaBlocks,
  StudioProject,
  StudioUpload,
} from '@/common/types/platform/audioStudio';

const ROOT = '/api/edu/audio/studio/projects';
/** Titles and scripts are user content, so request bodies are never logged. */
const SENSITIVE = { sensitive: true };
const project = (id: string): string => `${ROOT}/${encodeURIComponent(id)}`;

/** Standalone audio studio: project library, imported media and text blocks. */
export const studioApi = {
  list: (): Promise<StudioProject[]> => httpRequest('GET', ROOT, undefined, SENSITIVE),
  create: (title: string): Promise<StudioProject> => httpRequest('POST', ROOT, { title }, SENSITIVE),
  rename: (id: string, title: string): Promise<StudioProject> =>
    httpRequest('PATCH', project(id), { title }, SENSITIVE),
  remove: (id: string): Promise<void> => httpRequest('DELETE', project(id), undefined, SENSITIVE),
  media: (id: string): Promise<StudioMedia[]> => httpRequest('GET', `${project(id)}/media`, undefined, SENSITIVE),
  blocks: (id: string, path: string): Promise<StudioMediaBlocks> =>
    httpRequest('GET', `${project(id)}/media/blocks?${new URLSearchParams({ path }).toString()}`, undefined, SENSITIVE),
  /** Split (and, when possible, transcribe) a recording again; resolves to the import task id. */
  reimport: (id: string, path: string): Promise<{ taskId: string }> =>
    httpRequest('POST', `${project(id)}/media/import`, { path, transcribe: true }, SENSITIVE),
  removeMedia: (id: string, path: string): Promise<void> =>
    httpRequest('DELETE', `${project(id)}/media?${new URLSearchParams({ path }).toString()}`, undefined, SENSITIVE),
  /** Split a script into speech block texts (paragraphs, or lines when there are no blank lines). */
  text: (id: string, text: string): Promise<{ blocks: string[] }> =>
    httpRequest('POST', `${project(id)}/text`, { text }, SENSITIVE),
  /** Cookie-authenticated stream URL of a project file, with range support for seeking. */
  fileUrl: (id: string, path: string): string =>
    `${getBaseUrl()}${project(id)}/file?${new URLSearchParams({ path }).toString()}`,
  /** Read text aloud without a project; resolves to the finished MP3 or WAV audio. */
  async speech(input: QuickSpeechInput, signal?: AbortSignal): Promise<Blob> {
    const path = '/api/edu/audio/studio/speech';
    const csrf = resolveCoreCsrfToken();
    const response = await fetch(`${getBaseUrl()}${path}`, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      body: JSON.stringify(input),
    });
    if (!response.ok)
      throw new BackendHttpError({
        method: 'POST',
        path,
        status: response.status,
        body: await response.json().catch((): undefined => undefined),
        retryAfter: response.headers.get('retry-after'),
      });
    return response.blob();
  },
  /** Stream a file into the project's media folder and start splitting it into blocks. */
  async upload(id: string, file: File, signal?: AbortSignal): Promise<StudioUpload> {
    const path = `${project(id)}/media?${new URLSearchParams({ name: file.name }).toString()}`;
    const csrf = resolveCoreCsrfToken();
    const response = await fetch(`${getBaseUrl()}${path}`, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: { 'Content-Type': 'application/octet-stream', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      body: file,
    });
    const body: unknown = await response.json().catch((): undefined => undefined);
    if (!response.ok)
      throw new BackendHttpError({
        method: 'POST',
        path,
        status: response.status,
        body,
        retryAfter: response.headers.get('retry-after'),
      });
    return (body as { data: StudioUpload }).data;
  },
};
