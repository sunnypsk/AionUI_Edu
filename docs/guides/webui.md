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

The conversation-scoped `aionui_audio` MCP server exposes `transcribe_audio`, `synthesize_speech`, `render_listening_track` and `analyze_reference_audio` to Codex. Configure the Vercel API key and multimodal transcription model under **Settings → Tools → Audio tools**. The default is `google/gemini-3.8-flash`. Model candidates come from Vercel's live catalog; audio-capable models are suggested and a full multimodal model ID can be entered manually. Dedicated STT and streaming models are excluded. Unsupported models fail explicitly instead of silently switching models.

Transcription returns SRT unless TXT, VTT or JSON is requested. It preserves spoken Cantonese in Traditional Chinese by default. Long recordings are converted to 24 kHz mono MP3 and processed in five-minute chunks with two-second overlap, at most two requests at once. The host merges chunk offsets and overlapping text. Successful chunks survive failures in other ranges; partial results are explicitly unverified. Provider content filtering reports AUDIO_CONTENT_FILTERED and truncation reports AUDIO_OUTPUT_TRUNCATED, without automatic retries or model switching. Subtitle times are approximate sentence times, repaired to stay within the recording. Each task snapshots its model and key; later settings changes apply to new tasks only. Usage and costs are recorded host-side when returned by the provider and are never included in agent tool results, so they are not shown to teachers; a failed task may have incurred charges for requests already sent.

Speech uses Edge TTS with HiuMaan (female) or WanLung (male), one voice per MP3. Rate and volume use signed percentages, and pitch uses signed Hz. Optional subtitles come from the same Edge stream, without a transcription request. The client is pinned to `edge-tts==7.3.1`; this is Microsoft's Edge online service accessed through a community client, not the Azure Speech API. No Azure or Vercel key is needed for synthesis.

`render_listening_track` builds a listening test track from a workspace project file (`listening/<name>.listening.json`, schema in `packages/desktop/src/common/types/platform/listeningProject.ts`). Sections hold speech, pause, chime and clip segments, with a play count and gaps between plays and after each section. Clips reuse a window of an uploaded recording. A lexicon replaces text in TTS input only, so subtitles and the printable script keep the original wording. Each speech segment is cached under `listening/.segments/` by a hash of its voice settings and spoken text, so editing one line re-synthesizes only that line. FFmpeg joins the pieces sample-accurately. Standard teaching tracks normalize loudness to -16 LUFS; projects with sourceAudio retain the original sample rate, channels and MP3 bitrate (192 kbps fallback), without global normalization. Each source is decoded once into private PCM before sample trimming, so MP3 seeking cannot change retained samples. Temporary PCM is removed with the job. MP3 is re-encoded. Outputs are `track.mp3`, `track.srt`, `timeline.json` (segment start and end times), `script.txt` and, when a Vercel key is configured, `qa.json`. QA re-transcribes each newly synthesized segment once (cached by the same hash) and lists segments whose character similarity to the script is below 0.9. Without a key the track still renders and reports `AUDIO_QA_SKIPPED`. Invalid projects fail with `AUDIO_PROJECT_INVALID` and field-level `details`. Limits: 500 segments, 2,000 characters per speech segment, 90 minutes per track.

Teachers open a dedicated full-screen editor from a listening project's FileCard (**Edit**), at `#/conversation/:id/listening?path=<project path>`. **Script** and **Timeline** share the working copy and selection. The inspector edits the selected item or the project defaults and pronunciation lexicon. The timeline shows source waveforms and authored segments once, with a summary block for repeated plays. Drag a block's label to reorder it, drag a clip's waveform to select a source range, and drag its edges to trim. Selected ranges can be removed or replaced with speech; the original recording stays untouched. Insert controls add speech, pauses, chimes or workspace audio clips.

The transport plays the working copy immediately through Web Audio, without rendering a full MP3. It streams recordings in ranges of at most 30 seconds and reuses generated speech from the existing cache. Ungenerated lines play as estimated-duration silence and are highlighted; preview never starts TTS generation. A late audio request pauses playback with a buffering indicator; a failed source is reported and its time remains silent. Preview loudness can differ from the final MP3, which follows the host's existing normalization or source-preserving policy. Space plays/pauses, **S** splits a clip at the playhead, Delete removes the selected items/range, **⌘Z / ⇧⌘Z** undo/redo, **← / →** move one second (Shift: five), and **⌘S** saves immediately. Ctrl also works; typing in text fields does not trigger shortcuts.

Speech generation is manual: use **Generate** on a line or **Generate all (N)**. Text, effective voice settings and pronunciation changes invalidate the affected line immediately. Generation saves pending edits first, shows progress on the requested lines, and supports cancellation and retry. **Export** contains final rendering and its progress/stop control, the current MP3 and portable ZIP downloads, and QA review with **Sounds right** and jump-to-line actions. A cached-line player remains available in the script/inspector. Autosave runs after 1.5 seconds of inactivity; the page keeps up to 100 undo steps, including after saving. Back attempts to save pending changes before leaving and asks before discarding if saving fails.

The editor uses cookie-authenticated, CSRF-protected routes under `/api/edu/audio/listening` (load, save, render, cancel, QA, and `POST /segments/generate`). `GET /peaks` provides cached waveform peaks; `GET /range` provides short 24 kHz mono WAV previews. Both enforce conversation/workspace access. Saves include the revision that was loaded and fail with `AUDIO_PROJECT_CONFLICT` if the agent or another window changed the file; the teacher can reload or keep their changes. Only `*.listening.json` files can be edited this way. Teacher-started renders do not need an agent turn and are not cancelled by the agent's Stop; deleting the conversation cancels them. Accepting a QA reading is stored next to that line's cache entry, so it resets automatically when the line's text or voice changes. Usage and costs are never included in editor responses. Audio FileCards play inline.

`analyze_reference_audio` drafts an editable project from an uploaded reference recording. FFmpeg detects silence at `noise_db` (default -35 dB); `merge_gap` (default 1 second, bounded by `section_gap`) combines nearby sounds, and `section_gap` (default 3 seconds) separates sections. With a transcription key, the default `speech` mode drafts text for synthesis; without a key it defaults to `clip` mode, preserving the original audio. Explicit speech mode requires a key. Transcription uses Hong Kong Cantonese by default, accepts `language` and `instructions`, and runs at most two regions concurrently with requests of at most five minutes. Failed or empty transcripts stay as source clips with warnings. Complete, identical adjacent speech transcripts of at least 20 characters can become repeated plays; similar questions, short responses, incomplete transcripts and original clips are kept separate. Speaker assignment and the inferred structure still need review.

Analysis publishes `audio/<task-id>/reference.listening.json`, `analysis.json` (timings, transcripts and warnings), and a reference recording snapshot together after success. Clip paths use the snapshot so editing the upload later does not change the draft. Cancellation or publication failure leaves no partial bundle. In clip mode every source sample belongs to exactly one contiguous clip, including leading/trailing pauses, quiet background audio and repeated passages; silence detection only supplies navigation. Set transcribe=false to prepare this source-preserving draft without a key or model catalog. Speech mode retains its existing pause generation. Highly fragmented recordings are merged to at most 200 regions, and oversized transcript regions remain clips to respect the 500-segment project limit. Teachers open the draft's FileCard to edit recording paths, notes and start/end times or add clips; clip previews play only the selected window. The real-media regression can be run with `AIONUI_AUDIO_REFERENCE_TEST=1 bunx vitest run packages/web-host/src/audio/track/tests/ffmpeg.test.ts`; it uses synthetic local audio and no provider calls.

All audio tools accept `action=start|status|wait|cancel`. Start returns a task ID; wait lasts at most 50 seconds and can be repeated without starting another paid request. The agent waits for completion before delivering workspace-relative files through FileCard. Stop and conversation deletion cancel active work. Closing a wait alone does not cancel a task. A host restart marks unfinished tasks as interrupted and never reruns inference automatically. Task metadata and private per-user settings live under `audio/` in the data directory. API keys are not returned by settings reads, included in task records, or supplied to MCP children.

The editor supports marked-range replacement: generate before/after previews, then apply against the same revision. HiuMaan/WanLung use their natural duration; later material shifts by the duration difference. Synthetic voices differ from the original. Previews and exports have separate task kinds and never count as full renders. A full MP3 is current only for its saved project revision. ZIP export bundles source assets, the project, cached speech, analysis and the current full render when available; unpack its root into a new workspace to open project.listening.json. JSON alone does not include audio assets.

Uploads accept files up to 256 MiB with a separate 1 MiB multipart allowance. GET /api/fs/upload/limits supplies the limit; excessive files return FILE_TOO_LARGE (413), with details.maxBytes. Upload data streams to temporary storage before atomic publication. The managed Codex launcher is selected explicitly through AIONUI_MANAGED_CODEX_LAUNCHER, independent of login-shell PATH. GET /api/edu/audio/capabilities reports key presence and executable readiness without exposing credentials or making a paid cloud request.

Docker installs FFmpeg/FFprobe and the locked Python dependencies into `/opt/aionui-audio`. Local development startup bootstraps the pinned Python dependencies in the project venv; install FFmpeg separately. To prepare the venv manually from the repository root:

```bash
python3 -m venv .cache/audio-tools/venv
.cache/audio-tools/venv/bin/python -m pip install -r packages/web-host/src/audio/providers/requirements.txt
```

On Windows use `python` and `.cache/audio-tools/venv/Scripts/python.exe`. `AIONUI_AUDIO_PYTHON`, `AIONUI_FFMPEG` and `AIONUI_FFPROBE` may point to local executables. The Python helper inherits only basic OS, certificate and HTTP proxy variables, not provider credentials. Missing dependencies produce a tool error without preventing the WebUI from starting.

## Troubleshooting

Check `/healthz`, the host/Core logs and browser DevTools. Startup failures retain their error details in the browser console. Issue reports and diagnostics are no longer uploaded upstream.

For development checks and isolated browser tests, see [development](../contributing/development.md) and [browser tests](../../tests/e2e/README.md).
