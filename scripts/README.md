# WebUI scripts

- `webui.ts` builds the SPA when needed, resolves the pinned WebUI Core, and starts the standalone HTTP/WebSocket host. Use `--no-build` for prebuilt assets and `--no-open` to leave the browser closed.
- `resetpass.ts` resets an account through the Core account CLI. Pass the same `--data-dir` or `AIONUI_DATA_DIR` as the running host.
- `generate-i18n-types.js` and `check-i18n.js` generate and validate translation types.
- `codemods/` contains maintenance tools for shared data types.

`bun run build` builds the Codex launcher, checks OpenUI assets, and builds the SPA with ordinary Vite. The result stays in `out/renderer`.

Desktop installers, signing, native Node rebuilds and standalone downloadable Web CLI packaging are not supported by this fork. The NAS release and rollback tools live in `packages/web-host/docker/`.
