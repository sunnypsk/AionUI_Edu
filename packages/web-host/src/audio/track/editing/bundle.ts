import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ListeningProject } from '../../../../../desktop/src/common/types/platform/listeningProject.ts';
import { workspaceFile, runProcess } from '../../providers/media.js';
import { audioPython } from '../../providers/edge.js';
import { speechRequest } from '../project.js';
import { SEGMENT_CACHE } from '../render.js';

/** Export a self-contained workspace: source references become deduplicated relative asset paths. */
export async function exportBundle(options: {
  workspace: string;
  directory: string;
  project: ListeningProject;
  projectPath: string;
  revision: string;
  files: { path: string; format: string }[];
  signal: AbortSignal;
}): Promise<string[]> {
  const root = path.join(options.directory, 'bundle');
  await mkdir(path.join(root, 'assets'), { recursive: true, mode: 0o700 });
  const project = structuredClone(options.project);
  const paths = new Map<string, string>();
  const asset = async (name: string): Promise<string> => {
    if (paths.has(name)) return paths.get(name)!;
    const source = await workspaceFile(options.workspace, name);
    const hash = createHash('sha256');
    for await (const buffer of createReadStream(source, { signal: options.signal })) hash.update(buffer);
    const extension = path.extname(source).toLowerCase();
    const destination = `assets/${hash.digest('hex')}${/^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '.audio'}`;
    await copyFile(source, path.join(root, destination));
    paths.set(name, destination);
    return destination;
  };
  if (project.sourceAudio) project.sourceAudio = await asset(project.sourceAudio);
  for (const section of project.sections)
    for (const segment of section.segments) {
      options.signal.throwIfAborted();
      if (segment.type === 'clip') segment.path = await asset(segment.path);
      if (segment.type === 'speech') {
        if (segment.replaces) segment.replaces.path = await asset(segment.replaces.path);
        const key = speechRequest(project, segment).key;
        for (const extension of ['mp3', 'json', 'qa.json']) {
          const name = `${SEGMENT_CACHE}/${key}.${extension}`;
          const file = await workspaceFile(options.workspace, name).catch((): undefined => undefined);
          if (file) {
            await mkdir(path.join(root, SEGMENT_CACHE), { recursive: true });
            await copyFile(file, path.join(root, name));
          }
        }
      }
    }
  const report = path.posix.join(path.posix.dirname(options.projectPath), 'analysis.json');
  const reportFile = await workspaceFile(options.workspace, report).catch((): undefined => undefined);
  if (reportFile) {
    // Source report contains workspace paths; keep only portable timing/transcript diagnostics.
    const value = JSON.parse(await readFile(reportFile, 'utf8')) as Record<string, unknown>;
    delete value.sourcePath;
    await writeFile(path.join(root, 'analysis.json'), JSON.stringify(value, null, 2) + '\n');
  }
  if (options.files.length) {
    await mkdir(path.join(root, 'rendered'));
    for (const file of options.files)
      await copyFile(
        await workspaceFile(options.workspace, file.path),
        path.join(root, 'rendered', path.basename(file.path))
      );
  }
  await writeFile(path.join(root, 'project.listening.json'), JSON.stringify(project, null, 2) + '\n');
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({ version: 1, revision: options.revision, project: 'project.listening.json' }) + '\n'
  );
  const output = path.join(options.directory, 'listening-project.zip');
  await runProcess(
    audioPython(),
    [
      '-c',
      'import pathlib,sys,zipfile\nr=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_STORED,allowZip64=True) as z:\n for p in sorted(r.rglob("*")):\n  if p.is_file(): z.write(p,p.relative_to(r).as_posix())',
      root,
      output,
    ],
    options.signal
  );
  return [output];
}
