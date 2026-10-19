import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOpenUiCore } from '../../../packages/web-host/openui/core/resolve';
import { readWebUiAdminUsername, resetWebUiPassword } from '../../../packages/web-host/openui/core/accounts';

const execute = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync: execute }));

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openui-core-resolve-'));
  roots.push(root);
  const core = path.join(root, 'packages/web-host/openui/core');
  mkdirSync(core, { recursive: true });
  const binary = path.join(root, '.cache/openui-core/bin/linux-x64/aioncore');
  mkdirSync(path.dirname(binary), { recursive: true });
  const receipt = {
    commit: 'pinned-commit',
    sourceSha256: 'archive-hash',
    rustVersion: '1.95.0',
    sourceDateEpoch: 123,
    extensionVersion: '0.2.2-edu.openui.1',
    patchHash: hash('patch'),
    manifestHash: 'manifest',
    binarySha256: hash('fixture binary'),
  };
  writeFileSync(path.join(core, 'upstream.json'), JSON.stringify(receipt));
  writeFileSync(path.join(core, 'openui.patch'), 'patch');
  writeFileSync(path.join(core, '../version.json'), JSON.stringify({ hash: 'manifest' }));
  writeFileSync(binary, 'fixture binary');
  writeFileSync(binary + '.json', JSON.stringify(receipt));
  return { root, binary, core };
}
describe('WebUI Core provenance', () => {
  it('bootstraps through the local CLI while keeping the generated password out of argv', () => {
    execute.mockReset().mockReturnValue('');
    const password = resetWebUiPassword('/core', '/test-data');
    expect(execute).toHaveBeenCalledWith(
      '/core',
      ['--data-dir', '/test-data', 'user', 'set-password', '--password-stdin'],
      expect.objectContaining({ input: password + '\n' })
    );
    expect(password.length).toBeGreaterThan(30);
    expect(execute.mock.calls[0][1]).not.toContain(password);
    execute.mockReturnValue(
      'ID TYPE USERNAME STATUS CREATED_MS LAST_LOGIN_MS\nsystem_default_user       local     renamed-admin          active     1              -\n'
    );
    expect(readWebUiAdminUsername('/core', '/test-data')).toBe('renamed-admin');
  });
  it('selects the receipt-verified extension for the requested architecture', () => {
    const { root, binary } = fixture();
    expect(resolveOpenUiCore(root, { platform: 'linux', arch: 'x64', env: {} })).toBe(binary);
    expect(() => resolveOpenUiCore(root, { platform: 'linux', arch: 'arm64', env: {} })).toThrow('not built');
  });
  it('rejects a changed binary, patch or manifest instead of silently selecting an upstream binary', () => {
    for (const changed of ['binary', 'patch', 'manifest']) {
      const { root, binary, core } = fixture();
      writeFileSync(
        changed === 'binary' ? binary : path.join(core, changed === 'patch' ? 'openui.patch' : '../version.json'),
        changed === 'manifest' ? '{"hash":"new-manifest"}' : 'changed'
      );
      expect(() => resolveOpenUiCore(root, { platform: 'linux', arch: 'x64', env: {} })).toThrow('does not match');
    }
  });
  it('honors an explicit external Core override for compatibility-gated installations', () => {
    expect(resolveOpenUiCore('/unused', { env: { AIONUI_BACKEND_BIN: '/custom/aioncore' } })).toBe(
      path.resolve('/custom/aioncore')
    );
  });
});
