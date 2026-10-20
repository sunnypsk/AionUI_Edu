# WebUI browser tests

These Playwright tests use Chromium against the same HTTP WebUI launcher used by local development. Each worker starts an isolated AionCore and WebUI with a temporary data directory, a random administrator password, and a separate `CODEX_HOME`. The fixture stops its own processes and removes its temporary data when finished.

Build the matching Core and SPA first:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run openui:core:build
bun run package
bun run test:e2e -- tests/e2e/specs/app-launch.e2e.ts
```

Installed Google Chrome is the default browser. Set `AIONUI_E2E_BROWSER_CHANNEL=chromium` to use Playwright's Chromium after installing it with `bunx playwright install chromium`. Set `AIONUI_BACKEND_BIN` or `AIONUI_OPENUI_CORE_CACHE` to select an existing matching Core build.

`app-launch.e2e.ts` covers SPA reload, the mobile composer and authentication rejection. The broader feature specs require their respective agent/provider configuration; listing them does not verify them. Live agent turns can incur provider usage. Run only the relevant specs against disposable test data.

## Writing tests

Import `test` and `expect` from `fixtures.ts`. Use the authenticated `page` fixture for UI interactions and the worker's `webui.dataDir` for test-owned filesystem assertions. `invokeBridge()` and `httpInvoke()` call same-origin HTTP endpoints with the session cookie and CSRF token. Use these helpers for setup, assertions and cleanup; exercise user actions through the UI.

For the server-side file picker, call `chooseServerPathWhenPrompted(page, targetPath)` before triggering the picker. It fills and confirms the real dialog. Browser tests do not use native dialogs or IPC.

Screenshots and traces are written to `tests/e2e/results/`; the HTML report is in `tests/e2e/report/`. Set `E2E_TRACE=1` to retain failure traces and videos.

The larger OpenUI acceptance suite is available separately:

```bash
bun run openui:qa
```

It checks synthetic data migration, forms, persistence, browser isolation and desktop/mobile layouts. Linux container networking, Chromium sandboxing and NAS snapshot/rollback checks live under `packages/web-host/docker/`.
