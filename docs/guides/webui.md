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

In Settings → Agents, sign in to Factory using the official device-pairing link. Each AionUI user has a separate Factory account directory within the existing data volume. Login does not copy the host machine's Factory credentials. The container includes Droid `0.245.1` as a fallback. Local development can provide a bundled executable through `AIONUI_BUNDLED_DROID` or `PATH`; an explicit `AIONUI_DROID_BIN` override remains externally managed and disables in-app installation.

Codex can use the `aionui_specialists` MCP tools to delegate writing to the `argon` role or lesson, unit and curriculum design to the `opus` role. These are stable role identifiers, not model restrictions. Settings → Agents lets each user choose a model and reasoning level separately for each role. Fresh preferences start with `gemini-4-argon` / `low` and `claude-opus-5-5` / `medium`, subject to the live catalog. Changes apply to new tasks; existing drafts and their revisions keep their original model and reasoning. Each specialist uses a role-specific system prompt with Hong Kong secondary Chinese Language defaults instead of Factory's coding-agent preset. The division of labour lives in the `teaching-design` and `humanizer-zh` skills and the tool descriptions. `specialist_reply` continues the original session; `specialist_wait` waits up to 50 seconds; `specialist_get` retrieves every revision in pages.

Both Codex and Droid model pickers use the active CLI's model catalog and each model's supported/default reasoning. Refresh bypasses the one-minute cache. Unavailable saved selections remain visible and are never silently replaced; choose a supported combination before saving. Droid settings are stored separately from Factory credentials in `droid/users/<user>/preferences.json`.

Droid's update panel checks the official stable release and installs verified binaries under `runtime/droid-cli` inside the data volume. Linux and macOS x64/arm64 are supported, with baseline binaries on x64. SHA-256, version, SDK create/resume/settings and zero-tool checks must pass before atomic activation. Verification uses an isolated temporary home and sends no prompts. Updates affect new CLI processes across the instance, preserve previous binaries, and do not interrupt running tasks. The embedded updater remains disabled. A failed download or compatibility check leaves the active version unchanged.

Specialists receive only the supplied prompt and designated UTF-8 source files (256 KiB per file, 1 MiB total). The host checks real paths against the conversation workspace. Sessions have no tools, hooks, skills or external MCP access; settings are verified before every create/resume can generate text. The pinned CLI has hidden deferred tools, so the adapter maintains a verified disable list and refuses to run if additional tools remain enabled.

The conversation panel shows tasks, revisions and cancellation controls. Stop cancels initializing and running tasks even when Codex is idle. Results survive browser reloads, Codex suspension and MCP restarts. A host restart marks unfinished work as interrupted, retains partial drafts and never reruns paid inference automatically. Completed tasks remain available. Limits are two concurrent tasks per conversation and four per user.

Back up the entire data directory, including `droid/tasks.json` and `droid/users/`. Per-user credentials and native sessions live under that user's `home/.factory`; account credentials use Factory's encrypted file storage with keyring disabled. Do not add hooks or MCP configuration to this host-managed directory. Signing out cancels the user's active specialists and invokes Factory's logout protocol.

The isolated, no-inference compatibility gate is `bun packages/web-host/src/runtime/droid/smoke.ts`. The shared-browser smoke also checks that native Codex discovers all five specialist tools while preserving other MCP configuration. An actual Factory browser sign-in and small writing requests are still needed to verify account-specific connectors, credential persistence and writing quality after CLI upgrades.

## Audio tools

The conversation-scoped `aionui_audio` MCP server exposes `transcribe_audio` and `synthesize_speech` to Codex. Configure the Vercel API key and multimodal transcription model under **Settings → Tools → Audio tools**. The default is `google/gemini-3.8-flash`. Model candidates come from Vercel's live catalog; audio-capable models are suggested and a full multimodal model ID can be entered manually. Dedicated STT and streaming models are excluded. Unsupported models fail explicitly instead of silently switching models.

Transcription returns SRT unless TXT, VTT or JSON is requested. It preserves spoken Cantonese in Traditional Chinese by default. Long recordings are converted to 24 kHz mono MP3 and processed in five-minute chunks with two-second overlap, at most two requests at once. The host merges chunk offsets and overlapping text. Subtitle times are approximate sentence times, repaired to stay within the recording. Each task snapshots its model and key; later settings changes apply to new tasks only. Usage and costs are recorded when returned by the provider; a failed task may have incurred charges for requests already sent.

Speech uses Edge TTS with HiuMaan (female) or WanLung (male), one voice per MP3. Rate and volume use signed percentages, and pitch uses signed Hz. Optional subtitles come from the same Edge stream, without a transcription request. The client is pinned to `edge-tts==7.3.1`; this is Microsoft's Edge online service accessed through a community client, not the Azure Speech API. No Azure or Vercel key is needed for synthesis.

Both tools accept `action=start|status|wait|cancel`. Start returns a task ID; wait lasts at most 50 seconds and can be repeated without starting another paid request. The agent waits for completion before delivering workspace-relative files through FileCard. Stop and conversation deletion cancel active work. Closing a wait alone does not cancel a task. A host restart marks unfinished tasks as interrupted and never reruns inference automatically. Task metadata and private per-user settings live under `audio/` in the data directory. API keys are not returned by settings reads, included in task records, or supplied to MCP children.

Docker installs FFmpeg/FFprobe and the locked Python dependencies into `/opt/aionui-audio`. For local development, install FFmpeg and create the isolated environment from the repository root:

```bash
python3 -m venv .cache/audio-tools/venv
.cache/audio-tools/venv/bin/python -m pip install -r packages/web-host/src/audio/providers/requirements.txt
```

On Windows use `python` and `.cache/audio-tools/venv/Scripts/python.exe`. `AIONUI_AUDIO_PYTHON`, `AIONUI_FFMPEG` and `AIONUI_FFPROBE` may point to local executables. The Python helper inherits only basic OS, certificate and HTTP proxy variables, not provider credentials. Missing dependencies produce a tool error without preventing the WebUI from starting.

## Troubleshooting

Check `/healthz`, the host/Core logs and browser DevTools. Startup failures retain their error details in the browser console. Issue reports and diagnostics are no longer uploaded upstream.

For development checks and isolated browser tests, see [development](../contributing/development.md) and [browser tests](../../tests/e2e/README.md).
