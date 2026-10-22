import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const bundle = (name: string): string => path.join(root, 'dist-server', 'host', `${name}.mjs`);

describe('Node production runtime bundles', () => {
  it.each(['container', 'webui'])('bundles first-party code and preserves runtime packages in %s', async (name) => {
    const source = await readFile(bundle(name), 'utf8');
    const manifest = JSON.parse(await readFile(path.join(root, 'packages/web-host/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const imports = [...source.matchAll(/\b(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
    const allowed = Object.keys(manifest.dependencies);
    expect(
      imports.filter((name) => !isBuiltin(name) && !allowed.some((pkg) => name === pkg || name.startsWith(`${pkg}/`)))
    ).toEqual([]);
    expect(source).not.toMatch(/\bBun\./);
  });

  it('loads the supervisor module graph under Node and rejects non-container startup', () => {
    const result = spawnSync(process.execPath, [bundle('container')], {
      env: { ...process.env, AIONUI_CONTAINER: '0' },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CONTAINER_ENTRYPOINT_REQUIRES_LINUX_ROOT');
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
  });

  it.runIf(process.platform === 'linux')('fails without trying to rebuild missing production assets', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'node-host-bundle-'));
    try {
      const result = spawnSync(process.execPath, [bundle('webui'), '--no-build', '--no-open'], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          AIONUI_APP_ROOT: directory,
          AIONUI_DATA_DIR: path.join(directory, 'data'),
          AIONUI_OPEN_BROWSER: '0',
        },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('CODEX_RUNTIME_BUNDLE_MISSING');
      expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|bun build|web:runtime:build/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
