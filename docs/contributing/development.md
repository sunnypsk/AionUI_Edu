# WebUI development

This fork ships the Unraid Docker WebUI and supports local browser development on macOS. The native desktop and mobile apps and standalone download packages have been removed.

## Prerequisites

Use Node.js 24, Bun (CI and Docker use 1.4.3), and Rust 1.95.0 to build the pinned WebUI Core. Chrome must already be installed for local browser QA; tests do not install a browser automatically.

```bash
bun install
bun run openui:core:build
bun run webui
```

The Core build uses the pinned source and patch receipt in `packages/web-host/openui/core/`. A generic upstream Core binary does not include all of this fork's OpenUI/browser behavior. `AIONUI_BACKEND_BIN` can explicitly select a compatible prebuilt binary.

`bun run dev` and `bun run start` use the same standalone launcher. It rebuilds the SPA before serving it. Use `bun run webui --no-build --no-open` to serve existing assets. Development data defaults to `~/.aionui-web-dev`; production defaults to `~/.aionui-web`. Use an explicit `--data-dir` for isolated QA.

## Verification

```bash
just check
bun run test
just test-deploy
bun run build
bun run openui:qa
bun run test:e2e -- tests/e2e/specs/app-launch.e2e.ts
```

Browser fixtures start a real Core/WebUI on a random loopback port, use disposable account/data directories, and open a separate Chrome context. They do not use an Electron window or the NAS. Set `AIONUI_E2E_BROWSER_CHANNEL` to an already installed Playwright browser channel when necessary.

`out/renderer` contains the SPA, PWA assets and builtin skills. `dist-server/codex` contains the compiled launcher. Only server runtime dependencies are installed in the production image; browser libraries are build dependencies.

## NAS releases

Follow the Unraid guide linked from the repository root README. Run the prescribed `just push` gate only when a push is explicitly requested. Image publication and NAS rollout are separate from local checks, and an open browser page does not prove the deployed revision.
