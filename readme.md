## AionUI_Edu — Codex CLI default

This fork installs the official `@openai/codex` CLI as a pinned production dependency. After `bun install`, run `bun run codex --version` to verify it. Browser users can sign in through **Settings → Agents → Codex account**, using ChatGPT's official device-code flow. Credentials stay in the host's Codex auth store; do not commit them.

New chats use Codex CLI exclusively; the composer has no CLI or model picker. The default model is `gpt-6-astra` with `low` reasoning effort. Change these defaults in **Settings → Agents → Codex CLI settings**. Saved settings apply to new conversations and override historical assistant model preferences. Existing conversations retain their session configuration. Other CLI backends are not selectable.

Start the browser UI with `bun run webui`. This launcher puts the project's CLI binaries first on the backend's `PATH`. AionCore remains required for the WebUI's files, sessions, and API; Codex CLI is the conversation's agent runtime. The browser user does not need to install either component.

Humanizer-zh is bundled and enabled by default for new conversations. It automatically guides Chinese writing and polishing while preserving the requested language, facts, quotations, and code. Deselect `humanizer-zh` in the conversation's Skills menu or in the assistant's default Skills to opt out. Existing conversation skill snapshots stay unchanged. Its [source, local adaptations, and MIT license](public/builtin-skills/auto-inject/humanizer-zh/README.md) are included in the bundle.

For Unraid, the container includes SOCKS5 routing for the app, CLI, and their tools, configured in Settings and applied after a container restart. See the [Unraid setup, browser login, and proxy guide](packages/web-host/docker/README.md) for persistence, required container capabilities, and target-host verification.

## WebUI-only fork

This repository ships the Unraid Docker WebUI. Desktop and native mobile apps, installers, standalone download releases and upstream issue-reporting telemetry are not included. The WebUI remains usable from desktop and mobile browsers, including its PWA assets.

For local macOS development:

```bash
bun install
bun run openui:core:build
bun run webui
```

`bun run build` builds the Codex runtime, validates OpenUI, and builds the SPA with Vite into `out/renderer`. The renderer/common source stays under `packages/desktop/src` to avoid an unrelated path migration. The only workspace is `packages/web-host`.

See [local development and checks](docs/contributing/development.md), [contributor guidance](CONTRIBUTING.md), and the [NAS release, proxy and rollback guide](packages/web-host/docker/README.md). Existing chats, files, Codex account data and shared-browser profiles remain in the configured data directory; this reduction changes no data schema.

The frontend libraries are build dependencies. The production image installs only the WebUI host, the pinned Codex CLI and their runtime dependencies. AionCore, Chromium, fonts and sing-box remain required for the deployed features.

This fork derives from [AionUi](https://github.com/iOfficeAI/AionUi) under [Apache-2.0](LICENSE). Historical upstream design and translated documentation may describe platforms that this fork no longer ships.
