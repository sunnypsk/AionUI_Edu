type Mermaid = (typeof import('mermaid'))['default'];
type DiagramTheme = 'light' | 'dark';

let enginePromise: Promise<Mermaid> | undefined;
let initializedTheme: DiagramTheme | undefined;
let renderQueue: Promise<unknown> = Promise.resolve();

function loadMermaid(): Promise<Mermaid> {
  enginePromise ??= import('mermaid')
    .then((module) => module.default)
    .catch((error: unknown) => {
      enginePromise = undefined;
      throw error;
    });
  return enginePromise;
}

/** Load diagrams on demand and serialize access to Mermaid's shared theme configuration. */
export async function renderMermaid(
  id: string,
  source: string,
  theme: DiagramTheme,
  isCancelled: () => boolean
): Promise<string | undefined> {
  const engine = await loadMermaid();
  const render = async (): Promise<string | undefined> => {
    if (isCancelled()) return undefined;
    if (initializedTheme !== theme) {
      engine.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: theme === 'dark' ? 'dark' : 'default',
        fontFamily: 'inherit',
      });
      initializedTheme = theme;
    }
    const { svg } = await engine.render(id, source);
    return isCancelled() ? undefined : svg;
  };
  const result = renderQueue.then(render);
  // A bad diagram must not block subsequent diagrams or theme changes.
  renderQueue = result.catch((): undefined => undefined);
  return result;
}
