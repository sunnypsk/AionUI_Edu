import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCodexRuntime } from './src/runtime/codex/build.js';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(packageRoot, '../..');
const { dependencies } = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};

buildCodexRuntime();
// Bundle first-party TS/.js imports; keep packages that locate their own assets
// (notably Playwright) external and installed in the production image.
for (const [entry, output] of [
  ['scripts/webui.ts', 'webui.mjs'],
  ['packages/web-host/src/runtime/container.ts', 'container.mjs'],
]) {
  execFileSync(
    'bun',
    [
      'build',
      path.join(root, entry),
      '--target=node',
      '--format=esm',
      // Bun otherwise replaces NODE_ENV at build time, even for Node bundles.
      '--define=process.env.NODE_ENV=process.env.NODE_ENV',
      ...Object.keys(dependencies).map((name) => `--external=${name}`),
      `--outfile=${path.join(root, 'dist-server/host', output)}`,
    ],
    { cwd: root, stdio: 'inherit' }
  );
}
