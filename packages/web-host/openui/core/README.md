# AionCore extension sources

`upstream.json` pins upstream commit `47e66d0d151123e973b3fd1e77afcb5671b3f8c5`, the source archive checksum, Rust 1.95.0 and extension version `0.2.2-edu.openui.1`. `openui.patch` records the source changes. The generated frontend manifest is copied into Core during preparation. Build receipts record the upstream source, patch checksum, manifest hash, official library versions, Rust version and binary checksum.

The WebUI launcher, CLI packaging and Dockerfile use this extension. The receipt resolver rejects missing, stale or modified cached binaries. Explicit `AIONUI_BACKEND_BIN` and `AIONUI_BACKEND_BUNDLED_DIR` overrides remain supported; the browser independently checks their capabilities. Electron continues using the upstream backend.

The patch includes the additive database migration, owned message/program validation, revisioned state APIs, transactional fork copies, deletion cleanup, MCP runtime and OAuth lifecycle, permission cards, cancellation, durable mutation receipts, and prompt delivery for ordinary and team sends. The official MCP client SDK handles stdio and Streamable HTTP; a compatibility transport supports legacy SSE. Query accepts only tools explicitly annotated read-only. Native CLI permission modes with private rules retain the host confirmation card unless Core has an authoritative approval decision.

The Codex connection also accepts `AIONUI_CODEX_IDLE_TTL_MS` to opt into its existing native suspend/resume lifecycle. The container sets a 30-minute threshold; other hosts keep suspension disabled unless configured. Running turns and tracked child agents prevent suspension, and the next dispatch resumes the same Codex thread. The NAS updater retains its process guard rather than ignoring resident CLI processes.

Accepted conversation sends add an optional `user_message` containing the canonical persisted row. The renderer upserts this row independently of the WebSocket echo; older backends remain supported through the existing message lookup. Reconnect and turn completion reconcile cursor gaps and the current turn window, including tool rows updated before the newest cursor. Tool rows match by their call identity, and independently emitted tips retain the same message identity across realtime and persistence. An older HTTP snapshot cannot replace a completed live image result with a running card. Display recovery never resends a prompt or resets OpenUI drafts.

Native Codex image results retain `savedPath`/`saved_path` references to the original file. Inline PNG/JPEG/WebP/GIF results are stored under the owning conversation workspace's `.aionui-generated-images` directory, with a 32 MiB limit and stable tool-call identity for replay. Only file metadata reaches chat persistence and realtime events. Completed images remain visible outside collapsed tool steps even when the final assistant text is empty; preview and download use the authenticated raw-byte file stream. Failed or canceled tools do not display partial artifacts. Codex wire diagnostics record frame boundaries and sizes without copying image bytes or tool payloads.

Codex notifications are scoped to the bound thread before updating session bindings, turn state or message delivery. A subagent's completion must not end the parent's turn before its final `FileCard` arrives; that previously left the card's message unfinished until the background relay's three-minute idle timeout. Parent-scoped collaboration items continue to update the subagent roster. The bundled Codex 0.163.0 schemas (`v2/ThreadStartedNotification.json`, `v2/TurnCompletedNotification.json` and `v2/AgentMessageDeltaNotification.json`, generated with `codex app-server generate-json-schema`) define the thread identities used by this filter.

Office preview start and stop operations are serialized per user, resolved file and document type. Closing during startup waits for session registration before stopping the process; reopening waits for an earlier delayed stop instead of reusing a process that is about to be killed. Concurrent starts share one watch, while unrelated previews remain independent. Idle operation locks use weak references and are reclaimed on subsequent operations. The existing HTTP and preview status events provide lifecycle diagnostics without additional payload logging.

Prepare the source without starting a service:

```sh
bun packages/web-host/openui/core/build.ts --prepare-only
```

Build after installing Rust 1.95.0:

```sh
bun run openui:core:build
```

Use `--debug` for a development binary, or `--test` to run the affected database, conversation, MCP and team crates before building. `--test-idle` runs the focused Codex idle suspend/resume tests, including a native process and JSON-RPC fixture without inference; container builds require this gate. The fixture needs Python 3 on Unix. Set `AIONUI_IDLE_TEST_CODEX_LAUNCHER` to the absolute path of `packages/web-host/src/runtime/codex/codex` to also exercise the compiled Node launcher chain locally. Application route tests live in the patched `aionui-app` crate and should also be run for API changes. `--resolve-only` prints the verified binary path without building.

Set `AIONUI_OPENUI_CORE_CACHE` to move prepared sources and binaries. `CARGO_TARGET_DIR` controls Cargo artifacts independently; `AIONUI_OPENUI_CORE_OUTPUT` can choose the installation path. On macOS the script uses the standalone Command Line Tools package's selected `MacOSX.sdk` when available, without changing the system developer directory. macOS cross-architecture packaging requires the corresponding Rust target. Other platforms build on native runners.

Installation uses a staged binary and atomic rename so an already running Core retains its original executable. `SOURCE_DATE_EPOCH` fixes the embedded build timestamp to the upstream archive timestamp. This records reproducible inputs; byte-for-byte reproducibility across different build machines is not asserted.

When editing the extension, use an untouched archive extraction as the baseline and refresh the patch:

```sh
python3 packages/web-host/openui/core/refreshPatch.py /path/to/pristine-core /path/to/working-core
```

Never edit the generated prepared source as the authoritative copy: refresh the patch from the working source and let the fingerprint select a new preparation. Keep the frontend manifest generated from the pinned installed registries. Actual browser, agent and Linux-container acceptance remain separate from Rust compilation and unit tests.
