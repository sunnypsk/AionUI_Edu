import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAudioRuntime } from '../routes.js';
import { agentTask } from '../types.js';
import { signBrowserCapability } from '../../runtime/browser/types.js';

describe('audio settings authentication and CSRF', () => {
  let directory: string;
  let runtime: Awaited<ReturnType<typeof createAudioRuntime>>;
  let backend: http.Server;
  let host: http.Server;
  let url: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'audio-routes-'));
    await mkdir(path.join(directory, 'workspace'));
    backend = http.createServer((req, res) => {
      const valid =
        req.headers.cookie?.startsWith('session=alice') ||
        req.headers.authorization === 'Bearer alice' ||
        (req.headers['x-aionui-runtime-token'] === 'fixture-runtime-token' &&
          req.headers['x-aionui-user-id'] === 'alice');
      res.setHeader('content-type', 'application/json');
      if (!valid) {
        res.writeHead(401).end('{}');
        return;
      }
      res.end(
        JSON.stringify({
          data:
            req.url === '/api/auth/user'
              ? { user: { id: 'alice' } }
              : req.url === '/api/system/current-user'
                ? { id: 'alice' }
                : { id: 'lesson', extra: { workspace: path.join(directory, 'workspace') } },
        })
      );
    });
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
    runtime = await createAudioRuntime({ dataDir: directory });
    runtime.setBackendPort((backend.address() as { port: number }).port);
    host = http.createServer((req, res) => {
      void runtime.handleRequest(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(host.address() as { port: number }).port}`;
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
  const save = (url: string, csrf: string, cookieCsrf = 'rotated') =>
    fetch(`${url}/api/edu/audio/settings`, {
      method: 'POST',
      headers: {
        cookie: `session=alice; aionui-csrf-token=${cookieCsrf}`,
        'x-csrf-token': csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'google/gemini-3.8-flash', apiKey: 'fixture-private-key' }),
    });
  it('requires login and the current CSRF token, then returns no secret key', async () => {
    expect((await fetch(`${url}/api/edu/audio/settings`)).status).toBe(401);
    expect((await save(url, 'stale')).status).toBe(403);
    const response = await save(url, 'rotated');
    expect(await response.json()).toEqual({ data: { model: 'google/gemini-3.8-flash', hasApiKey: true } });
    const loaded = await fetch(`${url}/api/edu/audio/settings`, { headers: { authorization: 'Bearer alice' } });
    expect(await loaded.text()).not.toContain('fixture-private-key');
  });
  it('accepts a newly rotated token and can clear the saved key', async () => {
    expect((await save(url, 'first', 'first')).status).toBe(200);
    expect((await save(url, 'second', 'second')).status).toBe(200);
    const response = await fetch(`${url}/api/edu/audio/settings`, {
      method: 'POST',
      headers: { authorization: 'Bearer alice', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'google/gemini-3.8-flash', clearApiKey: true }),
    });
    expect(await response.json()).toMatchObject({ data: { hasApiKey: false } });
  });
  it('requires both a valid conversation capability and Core runtime identity', async () => {
    const capability = signBrowserCapability(runtime.env.AIONUI_AUDIO_SIGNING_KEY, 'alice', 'lesson');
    const request = (cap: string, token: string) =>
      fetch(`${runtime.env.AIONUI_AUDIO_GATEWAY}/command`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aionui-audio-capability': cap,
          'x-aionui-runtime-token': token,
        },
        body: JSON.stringify({
          name: 'synthesize_speech',
          arguments: { action: 'status', task_id: '00000000-0000-4000-8000-000000000000' },
        }),
      });
    expect((await request('invalid', 'fixture-runtime-token')).status).toBe(401);
    expect((await request(capability, 'wrong')).status).toBe(401);
    expect(await (await request(capability, 'fixture-runtime-token')).json()).toMatchObject({
      error: { code: 'AUDIO_TASK_NOT_FOUND' },
    });
  });
  it('serves the listening editor with CSRF-protected saves and revision checks', async () => {
    await mkdir(path.join(directory, 'workspace', 'listening'));
    const project = { version: 1, title: '單元二', sections: [{ id: 'a', segments: [{ id: 'p', type: 'chime' }] }] };
    await writeFile(path.join(directory, 'workspace', 'listening', 'unit.listening.json'), JSON.stringify(project));
    const target = { conversation_id: 'lesson', path: 'listening/unit.listening.json' };
    const loaded = await fetch(`${url}/api/edu/audio/listening?${new URLSearchParams(target)}`, {
      headers: { cookie: 'session=alice' },
    });
    const state = ((await loaded.json()) as { data: { revision: string; project: { title: string }; tasks: [] } }).data;
    expect(state).toMatchObject({ project: { title: '單元二' }, tasks: [] });
    const put = (csrf: string, revision: string) =>
      fetch(`${url}/api/edu/audio/listening`, {
        method: 'PUT',
        headers: {
          cookie: 'session=alice; aionui-csrf-token=token',
          'x-csrf-token': csrf,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...target, revision, project: { ...project, title: '單元三' } }),
      });
    expect((await put('stale', state.revision)).status).toBe(403);
    const saved = await put('token', state.revision);
    expect(await saved.json()).toMatchObject({ data: { project: { title: '單元三' } } });
    expect(await (await put('token', state.revision)).json()).toEqual({ error: { code: 'AUDIO_PROJECT_CONFLICT' } });
    expect(
      (
        await fetch(
          `${url}/api/edu/audio/listening?${new URLSearchParams({ ...target, path: '../x.listening.json' })}`,
          {
            headers: { cookie: 'session=alice' },
          }
        )
      ).status
    ).toBe(403);
  });
  it('returns listening project validation details to the agent', async () => {
    await writeFile(path.join(directory, 'workspace', 'unit.listening.json'), JSON.stringify({ version: 1 }));
    const response = await fetch(`${runtime.env.AIONUI_AUDIO_GATEWAY}/command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aionui-audio-capability': signBrowserCapability(runtime.env.AIONUI_AUDIO_SIGNING_KEY, 'alice', 'lesson'),
        'x-aionui-runtime-token': 'fixture-runtime-token',
      },
      body: JSON.stringify({ name: 'render_listening_track', arguments: { project_path: 'unit.listening.json' } }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'AUDIO_PROJECT_INVALID',
        details: expect.arrayContaining([expect.stringMatching(/^title: /), expect.stringMatching(/^sections: /)]),
      },
    });
  });
});

describe('agent task view', () => {
  it('omits usage, cost and cost warnings from tool results', () => {
    const view = agentTask({
      id: 'task',
      kind: 'transcription',
      status: 'completed',
      createdAt: 1,
      updatedAt: 2,
      completedChunks: 1,
      totalChunks: 1,
      files: [{ path: 'audio/task/transcript.srt', format: 'srt' }],
      usage: [{ chunk: 1, costUsd: 0.002 }],
      costUsd: 0.002,
      warnings: ['AUDIO_COST_INCOMPLETE', 'AUDIO_APPROXIMATE_TIMESTAMPS'],
    });
    expect(view).not.toHaveProperty('usage');
    expect(view).not.toHaveProperty('costUsd');
    expect(view.warnings).toEqual(['AUDIO_APPROXIMATE_TIMESTAMPS']);
    expect(view.files).toEqual([{ path: 'audio/task/transcript.srt', format: 'srt' }]);
  });
});
