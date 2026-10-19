import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installBundledBuiltinSkills } from '../../../packages/web-host/src/backend-launcher';

const bundledDir = path.resolve('public/builtin-skills');
const relativeDir = path.join('auto-inject', 'humanizer-zh');
const temporaryDirs: string[] = [];

async function makeBuiltinDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aionui-builtin-skills-test-'));
  temporaryDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('bundled Humanizer-zh installation', () => {
  it('installs a discoverable auto-inject skill with its license and automatic Chinese writing rules', async () => {
    const builtinDir = await makeBuiltinDir();
    await installBundledBuiltinSkills(bundledDir, builtinDir);
    const manifest = await readFile(path.join(builtinDir, relativeDir, 'SKILL.md'), 'utf8');

    expect(manifest).toMatch(/^---\nname: humanizer-zh\n/);
    expect(manifest).toContain('交付前自動依照以下規則作最後潤飾');
    expect(manifest).toContain('進度說明及開場白同樣適用');
    expect(manifest).toContain('不要提及技能名稱');
    expect(await readFile(path.join(builtinDir, relativeDir, 'LICENSE'), 'utf8')).toContain('MIT License');
  });

  it('does not request another catalog restart when bundled files are unchanged', async () => {
    const builtinDir = await makeBuiltinDir();

    expect(await installBundledBuiltinSkills(bundledDir, builtinDir)).toBe(true);
    expect(await installBundledBuiltinSkills(bundledDir, builtinDir)).toBe(false);
  });

  it('restores the skill after AionCore refreshes its corpus without changing other skills', async () => {
    const builtinDir = await makeBuiltinDir();
    await installBundledBuiltinSkills(bundledDir, builtinDir);
    await rm(path.join(builtinDir, relativeDir), { recursive: true });
    await mkdir(path.join(builtinDir, 'auto-inject', 'cron'), { recursive: true });
    const otherSkill = path.join(builtinDir, 'auto-inject', 'cron', 'SKILL.md');
    await writeFile(otherSkill, 'existing official skill');

    expect(await installBundledBuiltinSkills(bundledDir, builtinDir)).toBe(true);
    expect(await readFile(otherSkill, 'utf8')).toBe('existing official skill');
  });

  it('updates a stale installed copy to the bundled version', async () => {
    const builtinDir = await makeBuiltinDir();
    await installBundledBuiltinSkills(bundledDir, builtinDir);
    await writeFile(path.join(builtinDir, relativeDir, 'SKILL.md'), 'stale skill');

    expect(await installBundledBuiltinSkills(bundledDir, builtinDir)).toBe(true);
    expect(await installBundledBuiltinSkills(bundledDir, builtinDir)).toBe(false);
  });

  it('rejects an incomplete bundle before changing the installed skill', async () => {
    const builtinDir = await makeBuiltinDir();
    await installBundledBuiltinSkills(bundledDir, builtinDir);
    const incompleteBundle = await makeBuiltinDir();
    const manifestPath = path.join(builtinDir, relativeDir, 'SKILL.md');
    const original = await readFile(manifestPath, 'utf8');

    await expect(installBundledBuiltinSkills(incompleteBundle, builtinDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(manifestPath, 'utf8')).toBe(original);
  });

  it('reports an unwritable destination instead of claiming installation succeeded', async () => {
    const builtinDir = await makeBuiltinDir();
    await writeFile(path.join(builtinDir, 'auto-inject'), 'a file blocks the directory');

    await expect(installBundledBuiltinSkills(bundledDir, builtinDir)).rejects.toMatchObject({ code: 'ENOTDIR' });
  });
});
