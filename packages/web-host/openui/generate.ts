import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openuiLibrary, openuiChatLibrary, openuiPromptOptions, openuiChatPromptOptions } from '@openuidev/react-ui';
import { withTeacherComponents } from '../../desktop/src/common/openui/components';
import { TEACHER_RULES } from '../../desktop/src/common/openui/guidance';

const directory = new URL('./', import.meta.url);
// The manifest only needs schemas and prompts; the WebUI supplies the real renderers.
const specOnly = { SlideOutline: (): null => null, FileCard: (): null => null };
const full = withTeacherComponents(openuiLibrary, specOnly);
const chat = withTeacherComponents(openuiChatLibrary, specOnly);
const manifest = {
  protocol: 'openui/1',
  versions: { ui: '0.18.1', lang: '1.0.1', headless: '0.18.1' },
  libraries: {
    openui: {
      root: full.root,
      components: Object.keys(full.components).toSorted(),
      schema: full.toJSONSchema(),
      prompt: full.prompt({
        ...openuiPromptOptions,
        additionalRules: [...(openuiPromptOptions.additionalRules ?? []), ...TEACHER_RULES],
        toolCalls: true,
        bindings: true,
        builtinFunctions: true,
        inlineMode: true,
      }),
    },
    'openui-chat': {
      root: chat.root,
      components: Object.keys(chat.components).toSorted(),
      schema: chat.toJSONSchema(),
      prompt: chat.prompt({
        ...openuiChatPromptOptions,
        additionalRules: [...(openuiChatPromptOptions.additionalRules ?? []), ...TEACHER_RULES],
        toolCalls: true,
        bindings: true,
        builtinFunctions: true,
        inlineMode: true,
      }),
    },
  },
};
const hash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
const outputs = {
  'manifest.json': JSON.stringify({ ...manifest, hash }, null, 2) + '\n',
  'version.json': JSON.stringify({ protocol: manifest.protocol, versions: manifest.versions, hash }, null, 2) + '\n',
};
await Promise.all(
  Object.entries(outputs).map(async ([name, content]) => {
    const destination = new URL(name, directory);
    if (process.argv.includes('--check')) {
      if (
        JSON.stringify(JSON.parse(await readFile(destination, 'utf8').catch(() => 'null'))) !==
        JSON.stringify(JSON.parse(content))
      )
        throw new Error('OpenUI manifest is stale: ' + fileURLToPath(destination));
    } else {
      await writeFile(destination, content);
    }
  })
);
console.info('OpenUI manifest ' + hash);
