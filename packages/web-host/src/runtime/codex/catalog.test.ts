import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, it, expect, vi } from 'vitest';
import { CodexAuthService } from '../codexAuth.js';
import { CodexModelCatalog } from './catalog.js';

function client(page: (cursor?: string) => unknown) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  const methods: string[] = [];
  child.stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().trim().split('\n')) {
      const req = JSON.parse(line);
      methods.push(req.method);
      if (req.id)
        child.stdout.write(
          JSON.stringify({ id: req.id, result: req.method === 'model/list' ? page(req.params.cursor) : {} }) + '\n'
        );
    }
  });
  return { service: new CodexAuthService(() => child as unknown as ChildProcessWithoutNullStreams), methods, child };
}
const model = (id: string, effort: string) => ({
  id: `catalog-${id}`,
  model: id,
  displayName: id,
  defaultReasoningEffort: effort,
  supportedReasoningEfforts: [{ reasoningEffort: effort, description: '' }],
});
describe('Codex live catalog', () => {
  it('reads all pages and preserves execution IDs and future reasoning without starting a thread', async () => {
    const fixture = client((cursor) =>
      cursor
        ? { data: [model('next', 'ultra')], nextCursor: null }
        : { data: [model('first', 'low')], nextCursor: 'page2' }
    );
    try {
      const result = await fixture.service.models();
      expect(result.map((m) => [m.id, m.supportedReasoningEfforts])).toEqual([
        ['first', ['low']],
        ['next', ['ultra']],
      ]);
      expect(fixture.methods).toEqual(['initialize', 'initialized', 'model/list', 'model/list']);
    } finally {
      fixture.service.close();
    }
  });
  it('rejects malformed pages and repeated cursors instead of caching a partial list', async () => {
    for (const page of [{ data: 'wrong' }, { data: [model('m', 'high')], nextCursor: 'repeat' }]) {
      const fixture = client(() => page);
      try {
        await expect(fixture.service.models()).rejects.toThrow('CODEX_MODEL_CATALOG_INVALID');
      } finally {
        fixture.service.close();
      }
    }
  });
  it('refreshes after version/account changes and closes every short-lived process', async () => {
    const fixtures: ReturnType<typeof client>[] = [];
    const catalog = new CodexModelCatalog(() => {
      const fixture = client(() => ({ data: [model('m', 'low')] }));
      fixtures.push(fixture);
      return fixture.service;
    });
    try {
      await catalog.get('1.0.0', 0);
      await catalog.get('1.0.0', 0);
      expect(fixtures).toHaveLength(1);
      await catalog.get('1.1.0', 0);
      await catalog.get('1.1.0', 1);
      await catalog.get('1.1.0', 1, true);
      expect(fixtures).toHaveLength(4);
      expect(fixtures.every((f) => f.child.kill.mock.calls.length === 1)).toBe(true);
    } finally {
      catalog.close();
    }
  });
});
