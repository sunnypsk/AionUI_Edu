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

## Factory writing specialists

In Settings → Agents, sign in to Factory using the official device-pairing link. Each AionUI user has a separate Factory account directory within the existing data volume. Login does not copy the host machine's Factory credentials. The container includes Droid `0.245.1`; local development must provide that version on `PATH` or set `AIONUI_DROID_BIN` to its executable.

Codex can use the `aionui_specialists` MCP tools to delegate natural Chinese and general prose to `gemini-4-argon`, or stories and dialogue to `claude-opus-5-5`, both at `low`. Model availability is checked without silently substituting another model. `specialist_reply` continues the original session; `specialist_wait` waits up to 50 seconds; `specialist_get` retrieves every revision in pages. Codex should wait for the required drafts and preserve their wording when integrating them.

Specialists receive only the supplied prompt and designated UTF-8 source files (256 KiB per file, 1 MiB total). The host checks real paths against the conversation workspace. Sessions have no tools, hooks, skills or external MCP access; settings are verified before every create/resume can generate text. The pinned CLI has hidden deferred tools, so the adapter maintains a verified disable list and refuses to run if additional tools remain enabled.

The conversation panel shows tasks, revisions and cancellation controls. Stop cancels initializing and running tasks even when Codex is idle. Results survive browser reloads, Codex suspension and MCP restarts. A host restart marks unfinished work as interrupted, retains partial drafts and never reruns paid inference automatically. Completed tasks remain available. Limits are two concurrent tasks per conversation and four per user.

Back up the entire data directory, including `droid/tasks.json` and `droid/users/`. Per-user credentials and native sessions live under that user's `home/.factory`; account credentials use Factory's encrypted file storage with keyring disabled. Do not add hooks or MCP configuration to this host-managed directory. Signing out cancels the user's active specialists and invokes Factory's logout protocol.

The isolated, no-inference compatibility gate is `bun packages/web-host/src/runtime/droid/smoke.ts`. The shared-browser smoke also checks that native Codex discovers all five specialist tools while preserving other MCP configuration. An actual Factory browser sign-in and small writing requests are still needed to verify account-specific connectors, credential persistence and writing quality after CLI upgrades.

## Troubleshooting

Check `/healthz`, the host/Core logs and browser DevTools. Startup failures retain their error details in the browser console. Issue reports and diagnostics are no longer uploaded upstream.

For development checks and isolated browser tests, see [development](../contributing/development.md) and [browser tests](../../tests/e2e/README.md).
