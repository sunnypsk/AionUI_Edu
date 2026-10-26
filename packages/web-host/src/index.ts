import type { WebHostOptions, WebHostHandle } from './types.js';

export type { AppMetadata, BackendBinaryResolver, WebHostOptions, WebHostHandle } from './types.js';
export { readWebUiAdminUsername, resetWebUiPassword } from '../openui/core/accounts.js';
export { startStaticServer, stopStaticServer } from './static-server.js';
export type { StaticServerOptions, StaticServerHandle } from './static-server.js';

// Backend launcher exports (M4)
export {
  BackendStartupCancelledError,
  BackendLifecycleManager,
  buildSpawnArgs,
  buildSpawnEnv,
  findAvailablePort,
  startBackend,
  stopBackend,
} from './backend-launcher.js';
export type { BackendDirConfig, BackendLaunchOptions, BackendHandle, BackendStartOptions } from './backend-launcher.js';

/**
 * Start WebHost (main entry point).
 *
 * Orchestrates backend-launcher + static-server. web-host itself holds no
 * persistent configuration — callers (Electron main process, `bun run webui`
 * CLI) are responsible for resolving port / allowRemote from their own source
 * of truth (Electron ProcessConfig, CLI flags, env vars).
 */
export async function startWebHost(opts: WebHostOptions): Promise<WebHostHandle> {
  const { SessionValidator } = await import('./runtime/sessionAuth.js');
  let sessionBackendPort = 0;
  const sessionAuth = new SessionValidator(() => sessionBackendPort);
  const { startBackend } = await import('./backend-launcher.js');
  const { startStaticServer } = await import('./static-server.js');
  const browser =
    opts.enableRuntimeControls && opts.dataDir
      ? await (await import('./runtime/browser/index.js')).createBrowserRuntime({ dataDir: opts.dataDir, sessionAuth })
      : undefined;
  let specialists;
  let audio;
  try {
    specialists =
      opts.enableRuntimeControls && opts.dataDir
        ? await (
            await import('./runtime/droid/index.js')
          ).createSpecialistRuntime({ dataDir: opts.dataDir, sessionAuth })
        : undefined;
    audio =
      opts.enableRuntimeControls && opts.dataDir
        ? await (await import('./audio/index.js')).createAudioRuntime({ dataDir: opts.dataDir, sessionAuth })
        : undefined;
  } catch (error) {
    await Promise.allSettled([browser?.close(), specialists?.close(), audio?.close()]);
    throw error;
  }

  // 1. Start backend (M4)
  let backendHandle;
  if (opts.backend.kind === 'ownBackend') {
    try {
      backendHandle = await startBackend({
        app: opts.app,
        resolveBackend: opts.backend.resolveBackend,
        dataDir: opts.dataDir,
        logDir: opts.logDir,
        dirs: opts.dirs,
        runtimeEnv: { ...browser?.env, ...specialists?.env, ...audio?.env },
      });
    } catch (error) {
      await Promise.allSettled([browser?.close(), specialists?.close(), audio?.close()]);
      throw error;
    }
  } else {
    // useExistingBackend: create a fake handle
    backendHandle = {
      port: opts.backend.port,
      stop: async () => {
        // no-op: external backend
      },
    };
  }
  sessionBackendPort = backendHandle.port;
  browser?.setBackendPort(backendHandle.port);
  specialists?.setBackendPort(backendHandle.port);
  audio?.setBackendPort(backendHandle.port);

  const controls =
    opts.enableRuntimeControls && opts.dataDir
      ? (await import('./runtime/index.js')).createRuntimeControls({
          backendPort: backendHandle.port,
          sessionAuth,
          dataDir: opts.dataDir,
        })
      : undefined;
  let staticHandle;
  try {
    // 2. Start static-server (M5)
    staticHandle = await startStaticServer({
      staticDir: opts.staticDir,
      backendPort: backendHandle.port,
      port: opts.port,
      allowRemote: opts.allowRemote ?? false,
      handleRequest: async (req, res) => {
        if (await audio?.handleRequest(req, res)) return true;
        if (await specialists?.handleRequest(req, res)) return true;
        if (await browser?.handleRequest(req, res)) return true;
        return (await controls?.handleRequest(req, res)) ?? false;
      },
      onBackendResponse: async (req, status) => {
        sessionAuth.onBackendResponse(req, status);
        await Promise.all([specialists?.onBackendResponse(req, status), audio?.onBackendResponse(req, status)]);
      },
    });
  } catch (err) {
    // If static-server fails, clean up backend
    await backendHandle.stop();
    controls?.close();
    await Promise.allSettled([browser?.close(), specialists?.close(), audio?.close()]);
    throw err;
  }

  // 3. Return combined handle
  return {
    port: staticHandle.port,
    backendPort: backendHandle.port,
    url: staticHandle.url,
    localUrl: staticHandle.localUrl,
    networkUrl: staticHandle.networkUrl,
    lanIP: staticHandle.lanIP,
    async stop() {
      sessionAuth.clear();
      controls?.close();
      await Promise.all([browser?.close(), specialists?.close(), audio?.close()]);
      await staticHandle.stop();
      await backendHandle.stop();
    },
  };
}
