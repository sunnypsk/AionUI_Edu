import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import upstream from './upstream.json';
import { resolveOpenUiCore } from './resolve';

const coreDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(coreDirectory, '../../../..');
const cache = path.resolve(process.env.AIONUI_OPENUI_CORE_CACHE || path.join(root, '.cache', 'openui-core'));
const flags = new Set(process.argv.slice(2));
for (const flag of flags) {
  if (!['--prepare-only', '--test', '--test-idle', '--debug', '--resolve-only'].includes(flag))
    throw new Error(`Unknown argument: ${flag}`);
}
if (flags.has('--resolve-only')) {
  console.log(resolveOpenUiCore(root, { platform: process.env.PACK_PLATFORM, arch: process.env.PACK_ARCH }));
  process.exit(0);
}

const digest = (contents: Uint8Array | string): string => createHash('sha256').update(contents).digest('hex');
const manifestPath = path.join(coreDirectory, '..', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { hash: string; versions: Record<string, string> };
const { hash: manifestHash, ...manifestBody } = manifest;
if (digest(JSON.stringify(manifestBody)) !== manifestHash) throw new Error('OpenUI manifest content hash mismatch');
const browserVersion = JSON.parse(readFileSync(path.join(coreDirectory, '..', 'version.json'), 'utf8')) as {
  hash: string;
};
if (browserVersion.hash !== manifestHash) throw new Error('OpenUI browser and Core manifest hashes differ');
const patchPath = path.join(coreDirectory, 'openui.patch');
const patchHash = digest(readFileSync(patchPath));
const sourceHash = digest([upstream.sourceSha256, patchHash, manifest.hash].join(':'));
const source = path.join(cache, 'sources', sourceHash);
const prepared = path.join(source, '.openui-prepared');

/** Run a build tool without passing command text through a shell. */
function run(command: string, args: string[], cwd: string, env = process.env): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${String(result.status)}`);
}

mkdirSync(cache, { recursive: true });
if (!existsSync(prepared)) {
  const archive = path.join(cache, 'upstream.tar.gz');
  if (!existsSync(archive) || digest(readFileSync(archive)) !== upstream.sourceSha256) {
    const response = await fetch(upstream.sourceUrl, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Source download failed: ${response.status}`);
    const contents = new Uint8Array(await response.arrayBuffer());
    if (digest(contents) !== upstream.sourceSha256) throw new Error('Upstream source checksum mismatch');
    writeFileSync(archive, contents);
  }
  mkdirSync(path.dirname(source), { recursive: true });
  const temporary = mkdtempSync(path.join(path.dirname(source), '.prepare-'));
  try {
    run('tar', ['-xzf', archive, '--strip-components=1', '-C', temporary], root);
    run('patch', ['--batch', '--forward', '-p1', '-i', patchPath], temporary);
    const generated = path.join(temporary, 'crates', 'aionui-conversation', 'src', 'openui', 'manifest.json');
    mkdirSync(path.dirname(generated), { recursive: true });
    copyFileSync(manifestPath, generated);
    writeFileSync(path.join(temporary, '.openui-prepared'), sourceHash + '\n');
    if (!existsSync(prepared)) renameSync(temporary, source);
  } finally {
    // Only this invocation's freshly-created staging directory can be removed.
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (readFileSync(prepared, 'utf8').trim() !== sourceHash) throw new Error('Prepared source fingerprint mismatch');
console.log(`[openui/core] prepared ${upstream.commit}, patch ${patchHash}, manifest ${manifest.hash}`);

if (!flags.has('--prepare-only')) {
  const targetPlatform = process.env.PACK_PLATFORM || process.platform;
  const targetArch = process.env.PACK_ARCH || process.arch;
  if (targetPlatform !== process.platform)
    throw new Error(
      'Cross-platform Core builds require a native build machine; use --resolve-only with a prebuilt receipt.'
    );
  const rustTarget =
    targetArch === process.arch
      ? undefined
      : ({ 'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin' } as Record<string, string>)[
          `${targetPlatform}-${targetArch}`
        ];
  if (targetArch !== process.arch && !rustTarget) throw new Error('Unsupported cross-architecture Core build');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || '2',
    CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.join(cache, 'target'),
    SOURCE_DATE_EPOCH: String(upstream.sourceDateEpoch),
  };
  // Use the standalone package's selected SDK instead of an incompatible leftover newer SDK.
  if (process.platform === 'darwin' && !env.SDKROOT) {
    const developer = execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim();
    const selected = path.join(developer, 'SDKs', 'MacOSX.sdk');
    env.SDKROOT = existsSync(selected)
      ? selected
      : execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' }).trim();
  }
  const actualRust = execFileSync('rustc', ['--version'], { env, encoding: 'utf8' }).trim();
  if (!actualRust.startsWith(`rustc ${upstream.rustVersion} `))
    throw new Error(`Expected Rust ${upstream.rustVersion}, got ${actualRust}`);
  if (flags.has('--test'))
    run(
      'cargo',
      [
        'test',
        '--locked',
        '-p',
        'aionui-db',
        '-p',
        'aionui-conversation',
        '-p',
        'aionui-mcp',
        '-p',
        'aionui-team',
        '-p',
        'aionui-file',
        '-p',
        'aionui-runtime',
      ],
      source,
      env
    );
  const profile = flags.has('--debug') ? 'debug' : 'release';
  if (flags.has('--test-idle'))
    run(
      'cargo',
      [
        'test',
        '--locked',
        '-p',
        'aionui-session',
        '--lib',
        ...(profile === 'release' ? ['--release'] : []),
        'container_idle',
      ],
      source,
      env
    );
  run(
    'cargo',
    [
      'build',
      '--locked',
      '-p',
      'aionui-app',
      '--bin',
      'aioncore',
      ...(rustTarget ? ['--target', rustTarget] : []),
      ...(profile === 'release' ? ['--release'] : []),
    ],
    source,
    env
  );
  const executable = process.platform === 'win32' ? 'aioncore.exe' : 'aioncore';
  const binary = path.join(env.CARGO_TARGET_DIR!, ...(rustTarget ? [rustTarget] : []), profile, executable);
  const output =
    process.env.AIONUI_OPENUI_CORE_OUTPUT || path.join(cache, 'bin', `${targetPlatform}-${targetArch}`, executable);
  mkdirSync(path.dirname(output), { recursive: true });
  const installation = mkdtempSync(path.join(path.dirname(output), '.install-'));
  try {
    const stagedBinary = path.join(installation, executable);
    copyFileSync(binary, stagedBinary);
    if (process.platform !== 'win32') chmodSync(stagedBinary, 0o755);
    const stagedReceipt = stagedBinary + '.json';
    writeFileSync(
      stagedReceipt,
      JSON.stringify(
        {
          ...upstream,
          patchHash,
          manifestHash: manifest.hash,
          versions: manifest.versions,
          binarySha256: digest(readFileSync(stagedBinary)),
          rust: actualRust,
        },
        null,
        2
      ) + '\n'
    );
    // Existing Core processes keep their original executable inode during a rebuild.
    renameSync(stagedBinary, output);
    renameSync(stagedReceipt, output + '.json');
  } finally {
    rmSync(installation, { recursive: true, force: true });
  }
  console.log(`[openui/core] binary ${output}`);
}
