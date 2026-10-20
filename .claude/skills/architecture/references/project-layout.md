# WebUI project layout

This fork ships a single Unraid WebUI product. The only package workspace is `packages/web-host`.

- `packages/desktop/src/renderer/`: React frontend, styles, translations and browser services.
- `packages/desktop/src/common/`: shared contracts, HTTP/WebSocket adapters and browser-safe runtime utilities.
- `packages/desktop/vite.webui.config.ts`: ordinary Vite SPA build. The directory name remains for source-path compatibility.
- `packages/web-host/src/`: standalone server, Core lifecycle, Codex controls and shared-browser gateway.
- `packages/web-host/openui/`: versioned OpenUI assets, pinned Core source/patch receipts and browser QA.
- `packages/web-host/docker/`: NAS deployment, rollback, container/network verification and seccomp integration.
- `scripts/`: local WebUI/password launchers and i18n tools.
- `public/`: PWA assets and builtin skill additions, copied into `out/renderer`.
- `tests/`: retained browser/common behavior tests and HTTP-based E2E fixtures.

Build output, dependency installs and QA artifacts are ignored. Do not add new runtime code to the repository root or recreate native app, preload, installer or standalone download workspaces.
