# WebUI

This fork serves AionUi in desktop and mobile browsers. The deployment target is the Unraid `linux/amd64` Docker image; local development runs on macOS with Bun and a matching AionCore build.

For the NAS, follow the [Unraid deployment guide](../../packages/web-host/docker/README.md), including its data mount, shared Chromium sandbox, SOCKS5 routing and update/rollback instructions.

## Local development

```bash
bun install
bun run openui:core:build
bun run webui
```

The launcher builds the Codex runtime and SPA, starts Core and the HTTP gateway, and prints the local URL. The default port is `25809` in development and `25808` with `NODE_ENV=production`. Use `--port` or `AIONUI_PORT` to override it. `bun run webui:remote` enables access from other devices on the network.

Use `bun run webui --no-build --no-open` to reuse an existing build without opening a browser. Build assets stay in `out/renderer`, including the PWA, service worker and built-in skills.

## Accounts and data

A fresh installation prints the initial administrator credentials. Sign in through the browser and change the password. If the password is lost, run `bun run resetpass` against the same data directory.

The existing data locations are preserved:

- Production container: `/data`, mounted persistently on the NAS.
- Local development: `~/.aionui-web-dev`.
- Local production mode: `~/.aionui-web`.
- Local second instance: `~/.aionui-web-dev-2` with `AIONUI_MULTI_INSTANCE=1`.

`AIONUI_DATA_DIR` or `--data-dir` selects another directory. Use the same override for the launcher and password reset. This directory holds conversations, files, account state and browser profiles; keep its backup and permissions intact.

## Troubleshooting

Check `/healthz`, the host/Core logs and browser DevTools. Startup failures retain their error details in the browser console. Issue reports and diagnostics are no longer uploaded upstream.

For development checks and isolated browser tests, see [development](../contributing/development.md) and [browser tests](../../tests/e2e/README.md).
