import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openuiLibrary, openuiChatLibrary, openuiPromptOptions, openuiChatPromptOptions } from '@openuidev/react-ui';

const directory = new URL('./', import.meta.url);
const manifest = {
  protocol: 'openui/1',
  versions: { ui: '0.18.1', lang: '1.0.1', headless: '0.18.1' },
  libraries: {
    openui: {
      root: openuiLibrary.root,
      components: Object.keys(openuiLibrary.components).toSorted(),
      schema: openuiLibrary.toJSONSchema(),
      prompt: openuiLibrary.prompt({
        ...openuiPromptOptions,
        toolCalls: true,
        bindings: true,
        builtinFunctions: true,
        inlineMode: true,
      }),
    },
    'openui-chat': {
      root: openuiChatLibrary.root,
      components: Object.keys(openuiChatLibrary.components).toSorted(),
      schema: openuiChatLibrary.toJSONSchema(),
      prompt: openuiChatLibrary.prompt({
        ...openuiChatPromptOptions,
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
