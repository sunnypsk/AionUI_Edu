# Server and shared code

The server runs with Node/Bun under `packages/web-host`. Browser code runs from the compiled SPA under `packages/desktop/src/renderer`.

- HTTP/WebSocket serving, Core process lifecycle and host metadata belong to the host package.
- Codex auth/version controls, proxy settings and the browser gateway belong to `packages/web-host/src/runtime`.
- Shared frontend DTOs and adapters belong to `packages/desktop/src/common`; runtime imports used by the frontend must remain browser-safe.
- Keep the existing API, authentication, cookie/CSRF and WebSocket contracts. Do not bypass the gateway with a desktop IPC fallback.
- Do not import DOM APIs into the host or Node APIs into React. Do not add Electron adapters, workers or preload code.

Follow the architecture skill's directory-size, naming and file ownership rules for both source and tests.
