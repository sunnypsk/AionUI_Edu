import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CODEX_RUNTIME_BUNDLE = fileURLToPath(
  new URL('../../../../../dist-server/codex/launcher.mjs', import.meta.url)
);

/** Compile the lease launcher for Node without requiring a TypeScript loader in production. */
export function buildCodexRuntime(): void {
  execFileSync(
    'bun',
    [
      'build',
      fileURLToPath(new URL('./retention/launcher.ts', import.meta.url)),
      '--target=node',
      '--format=esm',
      `--outfile=${CODEX_RUNTIME_BUNDLE}`,
    ],
    { stdio: 'pipe' }
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) buildCodexRuntime();
