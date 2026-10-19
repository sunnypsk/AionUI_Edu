import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type Options = { env?: NodeJS.ProcessEnv; platform?: string; arch?: string };
const hash = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Resolve the WebUI extension and verify its source, manifest and binary receipt. */
export function resolveOpenUiCore(root: string, options: Options = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const executable = platform === 'win32' ? 'aioncore.exe' : 'aioncore';
  if (env.AIONUI_BACKEND_BIN) return path.resolve(env.AIONUI_BACKEND_BIN);
  if (env.AIONUI_BACKEND_BUNDLED_DIR)
    return path.join(env.AIONUI_BACKEND_BUNDLED_DIR, `${platform}-${arch}`, executable);
  const core = path.join(root, 'packages', 'web-host', 'openui', 'core');
  const cache = path.resolve(env.AIONUI_OPENUI_CORE_CACHE || path.join(root, '.cache', 'openui-core'));
  const binary = path.join(cache, 'bin', `${platform}-${arch}`, executable);
  const instruction = 'Build the WebUI Core with Rust 1.95.0: bun run openui:core:build';
  if (!existsSync(binary) || !existsSync(binary + '.json')) throw new Error(`OpenUI Core is not built. ${instruction}`);
  const receipt = JSON.parse(readFileSync(binary + '.json', 'utf8')) as Record<string, unknown>;
  const upstream = JSON.parse(readFileSync(path.join(core, 'upstream.json'), 'utf8')) as Record<string, unknown>;
  const manifest = JSON.parse(readFileSync(path.join(core, '..', 'version.json'), 'utf8')) as { hash: string };
  if (
    receipt.commit !== upstream.commit ||
    receipt.sourceSha256 !== upstream.sourceSha256 ||
    receipt.rustVersion !== upstream.rustVersion ||
    receipt.sourceDateEpoch !== upstream.sourceDateEpoch ||
    receipt.extensionVersion !== upstream.extensionVersion ||
    receipt.patchHash !== hash(path.join(core, 'openui.patch')) ||
    receipt.manifestHash !== manifest.hash ||
    receipt.binarySha256 !== hash(binary)
  ) {
    throw new Error(`OpenUI Core build receipt does not match this checkout. ${instruction}`);
  }
  return binary;
}
