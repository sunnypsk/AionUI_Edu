import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudioMediaBlocks, StudioProject } from '../../../../desktop/src/common/types/platform/audioStudio.ts';
import type { ListeningState } from '../../../../desktop/src/common/types/platform/listeningProject.ts';
import { AudioManager } from '../../audio/manager.js';
import { createAudioRuntime } from '../../audio/routes.js';

const USERS: Record<string, string> = { 'Bearer alice': 'alice', 'Bearer bob': 'bob' };

describe('audio studio routes', () => {
  let directory: string;
  let runtime: Awaited<ReturnType<typeof createAudioRuntime>>;
  let backend: http.Server;
  let host: http.Server;
  let url: string;
  let maxBytes: number;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'studio-routes-'));
    maxBytes = 1024 * 1024;
    backend = http.createServer((req, res) => {
      const user = USERS[req.headers.authorization ?? ''];
      res.setHeader('content-type', 'application/json');
      if (!user) {
        res.writeHead(401).end('{}');
        return;
      }
      res.end(
        JSON.stringify({
          data:
            req.url === '/api/auth/user'
              ? { user: { id: user } }
              : req.url === '/api/fs/upload/limits'
                ? { maxBytes }
                : { id: user },
        })
      );
    });
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
    const manager = new AudioManager(directory, {
      media: { probe: async () => 30, chunk: async () => {} },
      silences: async () => [{ start: 10, end: 14 }],
    });
    runtime = await createAudioRuntime({ dataDir: directory, manager });
    runtime.setBackendPort((backend.address() as { port: number }).port);
    host = http.createServer((req, res) => {
      void runtime.handleRequest(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(host.address() as { port: number }).port}/api/edu/audio`;
  });
  afterEach(async () => {
    await runtime.close();
    await Promise.all(
      [host, backend].map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          })
      )
    );
    await rm(directory, { recursive: true, force: true });
  });

  const call = async <T>(
    method: string,
    route: string,
    body?: unknown,
    options: { user?: string; type?: string } = {}
  ): Promise<{ status: number; data: T; error?: { code: string } }> => {
    const response = await fetch(`${url}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${options.user ?? 'alice'}`,
        ...(body === undefined ? {} : { 'content-type': options.type ?? 'application/json' }),
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const json = (await response.json()) as { data: T; error?: { code: string } };
    return { status: response.status, ...json };
  };
  const create = async (title = '第一課') => (await call<StudioProject>('POST', '/studio/projects', { title })).data;
  const upload = (id: string, name: string, content: string, user?: string) =>
    call<{ media: { path: string }; taskId: string }>(
      'POST',
      `/studio/projects/${id}/media?name=${encodeURIComponent(name)}`,
      content,
      { user, type: 'application/octet-stream' }
    );
  const waitForImport = async (id: string, taskId: string): Promise<ListeningState> => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = (await call<ListeningState>('GET', `/listening?project_id=${id}`)).data;
      if (state.tasks.some((task) => task.id === taskId && task.status === 'completed')) return state;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('import did not complete');
  };

  it('creates, lists, renames and deletes projects for the signed-in user only', async () => {
    const project = await create();
    expect((await call<StudioProject[]>('GET', '/studio/projects')).data.map((item) => item.id)).toEqual([project.id]);
    expect((await call<StudioProject[]>('GET', '/studio/projects', undefined, { user: 'bob' })).data).toEqual([]);
    expect(
      (await call('PATCH', `/studio/projects/${project.id}`, { title: '新名' }, { user: 'bob' })).error?.code
    ).toBe('AUDIO_PROJECT_NOT_FOUND');
    expect((await call<StudioProject>('PATCH', `/studio/projects/${project.id}`, { title: '新名' })).data.title).toBe(
      '新名'
    );
    expect((await call('POST', '/studio/projects', { title: ' ' })).status).toBe(400);
    expect((await call('DELETE', `/studio/projects/${project.id}`)).status).toBe(200);
    expect((await call<StudioProject[]>('GET', '/studio/projects')).data).toEqual([]);
  });

  it('opens a studio project in the listening editor by id', async () => {
    const project = await create();
    const state = (await call<ListeningState>('GET', `/listening?project_id=${project.id}`)).data;
    expect(state).toMatchObject({ path: 'project.listening.json', project: { title: '第一課' } });
    const saved = await call<ListeningState>('PUT', '/listening', {
      project_id: project.id,
      revision: state.revision,
      project: { ...state.project, title: '改名' },
    });
    expect(saved.data.project?.title).toBe('改名');
    expect((await call('GET', `/listening?project_id=${project.id}`, undefined, { user: 'bob' })).status).toBe(409);
  });

  it('uploads a recording and splits it into blocks in the background', async () => {
    const project = await create();
    const uploaded = await upload(project.id, '課文 錄音.mp3', 'fixture-audio');
    expect(uploaded.data.media.path).toBe('media/課文-錄音.mp3');
    // Same name again gets a fresh file rather than overwriting.
    expect((await upload(project.id, '課文 錄音.mp3', 'other')).data.media.path).toBe('media/課文-錄音-2.mp3');
    await waitForImport(project.id, uploaded.data.taskId);
    const blocks = await call<StudioMediaBlocks>(
      'GET',
      `/studio/projects/${project.id}/media/blocks?path=${encodeURIComponent(uploaded.data.media.path)}`
    );
    expect(blocks.data).toMatchObject({
      durationSeconds: 30,
      blocks: [
        { start: 0, end: 12 },
        { start: 12, end: 30 },
      ],
      warnings: ['AUDIO_ANALYSIS_NO_TRANSCRIPT'],
    });
  });

  it('rejects unsupported, oversized and JSON-typed uploads', async () => {
    const project = await create();
    expect((await upload(project.id, 'notes.txt', 'x')).error?.code).toBe('AUDIO_FORMAT_UNSUPPORTED');
    maxBytes = 4;
    expect((await upload(project.id, 'long.mp3', 'too long')).error?.code).toBe('AUDIO_FILE_TOO_LARGE');
    const json = await call('POST', `/studio/projects/${project.id}/media?name=a.mp3`, { x: 1 });
    expect(json.status).toBe(401);
    expect((await call<unknown[]>('GET', `/studio/projects/${project.id}/media`)).data).toEqual([]);
  });

  it('refuses to delete media used on the timeline and streams files with ranges', async () => {
    const project = await create();
    const { data } = await upload(project.id, 'talk.wav', '0123456789');
    await waitForImport(project.id, data.taskId);
    const state = (await call<ListeningState>('GET', `/listening?project_id=${project.id}`)).data;
    await call('PUT', '/listening', {
      project_id: project.id,
      revision: state.revision,
      project: {
        ...state.project,
        sections: [{ id: 'main', segments: [{ id: 'c1', type: 'clip', path: data.media.path, start: 0, end: 5 }] }],
      },
    });
    const route = `/studio/projects/${project.id}/media?path=${encodeURIComponent(data.media.path)}`;
    expect((await call('DELETE', route)).error?.code).toBe('AUDIO_MEDIA_IN_USE');
    const ranged = await fetch(`${url}/studio/projects/${project.id}/file?path=media/talk.wav`, {
      headers: { authorization: 'Bearer alice', range: 'bytes=2-5' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-type')).toBe('audio/wav');
    expect(await ranged.text()).toBe('2345');
    const outside = await fetch(`${url}/studio/projects/${project.id}/file?path=../../x`, {
      headers: { authorization: 'Bearer alice' },
    });
    expect(outside.status).toBe(403);
  });

  it('turns a script into speech blocks and deletes unused media', async () => {
    const project = await create();
    const text = await call<{ blocks: string[] }>('POST', `/studio/projects/${project.id}/text`, {
      text: '第一段\n\n第二段',
    });
    expect(text.data.blocks).toEqual(['第一段', '第二段']);
    const { data } = await upload(project.id, 'spare.mp3', 'x');
    await waitForImport(project.id, data.taskId);
    expect((await call('DELETE', `/studio/projects/${project.id}/media?path=media/spare.mp3`)).status).toBe(200);
    expect((await call<unknown[]>('GET', `/studio/projects/${project.id}/media`)).data).toEqual([]);
  });
});
