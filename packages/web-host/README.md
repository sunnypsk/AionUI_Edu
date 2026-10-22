# @aionui/web-host

WebUI host package for AionUi - zero Electron dependency.

## Responsibilities

- **backend-launcher**: spawn or reuse existing aioncore process
- **static-server**: serve out/renderer SPA + reverse proxy /api and /ws to backend
- **auth**: password reset, change, verify, config I/O (bcrypt + session)

## Usage

```ts
import { startWebHost } from '@aionui/web-host';

const handle = await startWebHost({
  app: {
    version: '1.0.0',
    isPackaged: false,
    resourcesPath: '/path/to/resources',
    userDataPath: '/path/to/userData',
  },
  staticDir: '/path/to/out/renderer',
  backend: {
    kind: 'ownBackend',
    resolveBackend: () => '/path/to/aioncore',
  },
});

console.log(`WebUI running at ${handle.url}`);

await handle.stop();
```

## Production runtime

`bun run web:runtime:build` bundles the host and container supervisor into
`dist-server/host/*.mjs` for Node, alongside the Codex launcher. Runtime dependencies
remain external packages in `node_modules`; Bun is used for builds and local development.

The container runs `tini -- node /app/dist-server/host/container.mjs` and sets
`AIONUI_APP_ROOT=/app`. The supervisor checks the bundled host, Codex launcher and
renderer before changing networking, then launches the Node host with reduced privileges.
Missing production assets fail startup instead of invoking a build in the container.
Existing `/data`, proxy routing, authentication and shutdown behavior are preserved.

This removes the two Bun processes observed aborting in production. The original
native crash trigger is unknown; unit/build checks do not establish long-term runtime stability.
