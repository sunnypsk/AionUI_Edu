import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import UnoCSS from 'unocss/vite';
import unoConfig from '../../uno.config';

const rootPackageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };
const rendererRoot = resolve('packages/desktop/src/renderer');

function compressedAssetsPlugin(): Plugin {
  const compressBrotli = promisify(brotliCompress);
  const compressGzip = promisify(gzip);
  return {
    name: 'precompress-static-assets',
    apply: 'build',
    async writeBundle(options, bundle) {
      if (!options.dir) throw new Error('Static asset compression requires an output directory');
      const outputDir = options.dir;
      const assets = Object.values(bundle).filter((asset) => /\.(js|css|json|svg)$/.test(asset.fileName));
      // Bound build-time work; the server only streams these immutable files.
      for (let start = 0; start < assets.length; start += 4) {
        await Promise.all(
          assets.slice(start, start + 4).map(async (asset) => {
            // Read the final bytes after Vite rewrites preload imports and CSS.
            const source = await readFile(resolve(outputDir, asset.fileName));
            if (source.length < 1024) return;
            const [br, gz] = await Promise.all([
              compressBrotli(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
              compressGzip(source),
            ]);
            if (br.length < source.length) await writeFile(resolve(outputDir, `${asset.fileName}.br`), br);
            if (gz.length < source.length) await writeFile(resolve(outputDir, `${asset.fileName}.gz`), gz);
          })
        );
      }
    },
  };
}

function iconParkPlugin() {
  return {
    name: 'vite-plugin-icon-park',
    enforce: 'pre' as const,
    transform(source: string, id: string) {
      if (!id.endsWith('.tsx') || id.includes('node_modules')) return null;
      if (!source.includes('@icon-park/react')) return null;
      const transformedSource = source.replace(
        /import\s+\{\s+([a-zA-Z, ]*)\s+\}\s+from\s+['"]@icon-park\/react['"](;?)/g,
        function (str, match) {
          if (!match) return str;
          const components = match.split(',');
          const importComponent = str.replace(
            match,
            components.map((key: string) => `${key} as _${key.trim()}`).join(', ')
          );
          const hoc = `import IconParkHOC from '@renderer/components/IconParkHOC';
          ${components.map((key: string) => `const ${key.trim()} = IconParkHOC(_${key.trim()})`).join(';\n')}`;
          return importComponent + ';' + hoc;
        }
      );
      if (transformedSource !== source) return { code: transformedSource, map: null } as { code: string; map: null };
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development';
  return {
    // Keep the existing renderer root and output contract.
    // Make the root explicit so Vite emits page names relative to that directory
    // instead of leaking source-relative ../../ paths into HTML asset names.
    root: rendererRoot,
    base: './',
    publicDir: resolve('public'),
    appType: 'mpa',
    server: {
      // Default to 5173; when occupied (e.g. another AionUi clone is running),
      // Vite auto-increments to the next available port.
      port: 5173,
      // Explicit HMR host so Vite client connects directly to the Vite dev server,
      // not to the WebUI proxy server (which would reject the WebSocket and cause infinite reload).
      // Port is omitted so it automatically matches the server port.
      hmr: {
        host: 'localhost',
      },
    },
    resolve: {
      alias: {
        '@': resolve('packages/desktop/src'),
        '@common': resolve('packages/desktop/src/common'),
        '@renderer': resolve('packages/desktop/src/renderer'),
        // Force ESM version of streamdown
        streamdown: resolve('node_modules/streamdown/dist/index.js'),
      },
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
      // CodeMirror relies on module-level singletons (highlighterFacet, tag
      // sets). If Vite pre-bundles two copies of @codemirror/language (one for
      // our direct import, one nested under @uiw/react-codemirror), our custom
      // markdown HighlightStyle registers on a facet the editor never reads,
      // so the source view silently falls back to near-monochrome. Dedupe the
      // singleton packages to a single physical copy. Only packages hoisted to
      // the top-level node_modules may be deduped here — @lezer/common is not
      // hoisted under bun's isolated layout, so listing it breaks the Rollup
      // production build (cannot resolve from nested @codemirror/lang-* dirs).
      dedupe: [
        'react',
        'react-dom',
        'react-router-dom',
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/language',
        '@lezer/highlight',
      ],
    },
    plugins: [UnoCSS(unoConfig), iconParkPlugin(), compressedAssetsPlugin()],
    build: {
      outDir: resolve('out/renderer'),
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: isDevelopment,
      minify: !isDevelopment,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 1500,
      cssCodeSplit: true,
      rollupOptions: {
        input: {
          index: resolve(rendererRoot, 'index.html'),
        },
        external: ['node:crypto', 'crypto'],
        onwarn(warning, warn) {
          if (warning.code === 'EVAL') return;
          warn(warning);
        },
        output: {
          manualChunks(id: string) {
            if (id.includes('commonjsHelpers')) return 'vendor';
            if (!id.includes('node_modules')) return undefined;
            // Keep React and every vendor tightly coupled to it in ONE chunk.
            //
            // Splitting these into separate manual chunks (vendor-react,
            // vendor-arco, vendor-highlight, vendor-markdown, vendor-editor)
            // produced circular ESM imports between the emitted chunks:
            //   vendor-react -> vendor-editor -> vendor-highlight
            //     -> vendor-arco -> vendor-react
            // (the loose `/react/` match also pulled React wrappers such as
            // @monaco-editor/react into vendor-react, wiring it to the editor
            // chunk). With a chunk cycle, ESM evaluation order left React's
            // exports uninitialized when vendor-arco's top level ran
            // `React.createContext`, throwing
            // "Cannot read properties of undefined (reading 'createContext')"
            // and leaving #root empty — a full white screen in the packaged
            // build. Co-locating them removes the
            // cross-chunk edges entirely; a single vendor chunk is loaded from
            // disk (file://) so the extra granularity bought nothing.
            if (
              id.includes('/react-dom/') ||
              id.includes('/react/') ||
              id.includes('/@arco-design/') ||
              id.includes('/react-markdown/') ||
              id.includes('/remark-') ||
              id.includes('/rehype-') ||
              id.includes('/unified/') ||
              id.includes('/mdast-') ||
              id.includes('/hast-') ||
              id.includes('/micromark') ||
              id.includes('/katex/') ||
              // WaveDrom timing diagrams (markdown code blocks, CJS)
              id.includes('/wavedrom/')
            )
              return 'vendor';
            if (id.includes('/@icon-park/')) return 'vendor-icons';
            if (id.includes('/diff2html/')) return 'vendor-diff';
            return undefined;
          },
        },
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'process.env.env': JSON.stringify(process.env.env),
      'process.env.AIONUI_MULTI_INSTANCE': JSON.stringify(process.env.AIONUI_MULTI_INSTANCE ?? ''),
      // Inject the real AionUi version (root package.json) so renderer code
      // can show it without a separate frontend package manifest.
      __APP_VERSION__: JSON.stringify(rootPackageJson.version),
      global: 'globalThis',
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        'react-i18next',
        'i18next',
        '@arco-design/web-react',
        '@icon-park/react',
        'react-markdown',
        'react-syntax-highlighter',
        'classnames',
        'swr',
        'eventemitter3',
        'katex',
        'diff2html',
        'remark-gfm',
        'remark-math',
        'remark-breaks',
        'rehype-raw',
        'rehype-katex',
        'wavedrom',
        // Pre-bundle the CodeMirror entry points together so they share a
        // single @codemirror/language copy (see dedupe note above); otherwise
        // the markdown source view loses its custom syntax highlighting.
        '@uiw/react-codemirror',
        '@codemirror/lang-markdown',
        '@codemirror/language',
      ],
    },
  };
});
