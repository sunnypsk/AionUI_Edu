import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createParser } from '@openuidev/react-lang';
import { openuiLibrary } from '@openuidev/react-ui';
import { installBundledBuiltinSkills } from '../../../packages/web-host/src/backend-launcher';
import { withTeacherComponents } from '@/common/openui/components';

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

describe('bundled teaching-design installation', () => {
  const teachingDir = path.join('auto-inject', 'teaching-design');
  const exists = (target: string) =>
    stat(target).then(
      () => true,
      () => false
    );
  it('installs teaching-design as an auto-inject skill with its playbooks', async () => {
    const builtinDir = await makeBuiltinDir();
    await installBundledBuiltinSkills(bundledDir, builtinDir);
    const manifest = await readFile(path.join(builtinDir, teachingDir, 'SKILL.md'), 'utf8');
    expect(manifest).toMatch(/^---\nname: teaching-design\n/);
    for (const term of [
      'SlideOutline',
      'FileCard',
      '確認並製作',
      'officecli-pptx',
      'officecli-docx',
      '指定文言經典精選',
      '評分準則',
      'openui/1',
    ])
      expect(manifest).toContain(term);
    expect(await readFile(path.join(builtinDir, teachingDir, 'README.md'), 'utf8')).toContain('teaching-design');
  });
  it('fails without installing any skill when one bundled file is missing', async () => {
    const builtinDir = await makeBuiltinDir();
    const bundle = await makeBuiltinDir();
    await cp(bundledDir, bundle, { recursive: true });
    await rm(path.join(bundle, teachingDir, 'README.md'));
    await expect(installBundledBuiltinSkills(bundle, builtinDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await exists(path.join(builtinDir, relativeDir))).toBe(false);
    expect(await exists(path.join(builtinDir, teachingDir))).toBe(false);
  });
  it('reports a change when only teaching-design changed', async () => {
    const builtinDir = await makeBuiltinDir();
    await installBundledBuiltinSkills(bundledDir, builtinDir);
    await writeFile(path.join(builtinDir, teachingDir, 'SKILL.md'), 'stale skill');
    expect(await installBundledBuiltinSkills(bundledDir, builtinDir)).toBe(true);
    expect(await readFile(path.join(builtinDir, teachingDir, 'SKILL.md'), 'utf8')).toMatch(
      /^---\nname: teaching-design/
    );
  });
  it('ships only OpenUI examples that parse against the teacher component library', async () => {
    const manifest = await readFile(path.join(bundledDir, teachingDir, 'SKILL.md'), 'utf8');
    const programs = [...manifest.matchAll(/```openui\n([\s\S]*?)\n```/g)].map((match) => match[1]);
    expect(programs.length).toBeGreaterThanOrEqual(4);
    const library = withTeacherComponents(openuiLibrary, { SlideOutline: () => null, FileCard: () => null });
    const parser = createParser(library.toJSONSchema(), library.root);
    for (const program of programs) {
      const result = parser.parse(program);
      expect([program.slice(0, 60), result.meta.errors, result.meta.unresolved]).toEqual([
        program.slice(0, 60),
        [],
        [],
      ]);
    }
  });
  it('allows specified and small requests to finish without a confirmation or planning specialist', async () => {
    const manifest = await readFile(path.join(bundledDir, teachingDir, 'SKILL.md'), 'utf8');
    for (const rule of [
      '已指定輸出格式及數量',
      '10 項或以下',
      '不要為了出計劃而啟動 `opus`',
      '開場、進度更新、OpenUI 標題',
      '不因缺少 OpenUI 而多問一次',
    ])
      expect(manifest).toContain(rule);
    expect(manifest).not.toContain('老師說「直接做」或「唔使問」就跳過計劃。');
  });
});
