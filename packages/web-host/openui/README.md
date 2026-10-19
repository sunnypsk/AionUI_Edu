# OpenUI runtime assets

The manifest is generated from the pinned, installed official component libraries. Both the WebUI and the extended AionCore must report the same protocol and manifest hash before interactive rendering or prompt injection is enabled.

Run `bun packages/web-host/openui/generate.ts` after an intentional library upgrade. Run the same command with `--check` in validation. The full manifest contains the official schemas and prompts; `version.json` is the small browser compatibility contract.

Upstream: https://github.com/thesysdev/openui (MIT). Generated prompts and schemas retain the upstream component contracts. Runtime integration must keep the two library profiles separate. The MIT notice ships in the renderer as `openui-license.txt`.

## Runtime and verification

The WebUI launcher, CLI package and Dockerfile select the patched `0.2.2-edu.openui.1` Core. Electron retains its existing upstream backend. The custom build uses the fixed upstream archive and patch in [core/](core/README.md); the launcher verifies its receipt and binary checksum. An explicitly configured external backend still passes the browser compatibility handshake. Missing or incompatible capabilities disable automatic OpenUI generation and tool calls.

The Core extension implements authenticated state storage, optimistic revisions, transactional fork snapshots, cascade deletion, conversation-scoped MCP execution, OAuth refresh, mutation confirmations and durable operation receipts. `Query` requires an explicit MCP read-only annotation. Other tools require a user action and follow the conversation permission policy; native CLI modes whose private rules cannot be evaluated by Core retain the host confirmation card. Tools use a namespace containing both server ID and tool name. Credentials remain in Core.

Each send through the shared WebUI bridge advertises `openui/1` after the compatibility handshake. Core injects the generated official contracts and actual conversation tool schemas into agent input while retaining ordinary stored user text. The account preference `openuiEnabled` defaults to true; disabling it keeps historical interfaces readable. Both ordinary and team conversations carry follow-up form context.

The public renderer entry is `MessageText/integration.tsx`; the private runtime is in `MessageText/OpenUI/`. Markdown remains in its existing Shadow DOM. Official OpenUI components render outside it, with the official stylesheet and scoped ThemeProvider including portals. Streaming, unfinished messages and state restoration gate interaction. Dirty drafts survive conversation unmounts; saving uses revisions, and conflicts require an explicit reload/reapply decision.

Tests in `tests/unit/chat/messageText/` cover all 82 full-library entries and 84 chat-library entries against the pinned registries, plus state, transport, forms, modal, tabs and follow-up behavior. JSDOM chart tests substitute canvas text measurement and media queries. Core tests additionally use actual stdio, SSE and Streamable HTTP fixture servers, including cancellation and OAuth refresh.

The local validation snapshot and remaining Docker limitation are recorded in [qa/README.md](qa/README.md).

Rendered acceptance uses an isolated temporary database, accounts, loopback WebUI and headless Chrome; it does not modify the normal user database:

```sh
bun run package
bun run openui:qa
```

Set `AIONUI_QA_CHROME` to another Chrome executable when needed. Evidence and screenshots are saved under `.cache/openui-qa/`. Browser acceptance, real configured-agent generation and Docker startup/restart must pass separately before claiming complete support. Automated component and Rust checks alone do not establish those results.

## Client API contract for the Core extension

These routes are implemented by the patched Core and consumed by the WebUI. All successful responses use the existing `{ data: T }` envelope and existing authenticated account context.

| Route                                                                       | Client contract                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/openui/capabilities`                                              | `{ protocol, hash, enabled }`; protocol and hash must match `version.json`. Disabling generation must not make historical state unreadable.                                                           |
| `GET /api/conversations/{id}/openui/tools`                                  | An array of `{ key, name, description?, input_schema, read_only }` for the conversation's final effective MCP snapshot.                                                                               |
| `POST /api/conversations/{id}/openui/tools/call`                            | Accept `{ tool_key, mode, arguments, message_id, block_id, program_hash, operation_id? }`. Return the original MCP `{ content, structuredContent?, isError? }`. `mode` is `query` or `mutation`.      |
| `GET /api/conversations/{id}/messages/{messageId}/openui/{blockId}/state`   | Return `{ state, revision, program_hash, library_id, library_version }` after resolving the original assistant program and formal database message ID. A new block returns empty state at revision 0. |
| `PATCH /api/conversations/{id}/messages/{messageId}/openui/{blockId}/state` | Compare the submitted revision and program metadata; save atomically and return the new snapshot. Return 409 on revision conflicts, preserving the remote snapshot.                                   |

`library_id` is `openui` or `openui-chat`, and `blockId` is the zero-based OpenUI block ordinal in that message. State is separate from the original message. The client first reads the existing message-detail endpoint: a fork's database row ID wins over its retained source `msg_id`; a live renderer UUID falls back to its source ID only on 404. Only finalized assistant text rows enable interaction. The server resolves programs with the same fence/envelope rules as the client; it rejects arbitrary caller-supplied program hashes or another account's message IDs.

Every verified WebUI message send waits for the compatibility handshake and adds `ui_capabilities: ['openui/1']` at the shared HTTP boundary. OpenUI follow-ups additionally carry `ui_action: { message_id, block_id, form_state, form_name?, context? }`, including queued and team sends. The server must validate the source block, retain structured context for the agent and respect the account's `openuiEnabled` preference when injecting guidance. Generated library prompts describe standalone OpenUI programs; host guidance must also explain fenced mixed Markdown responses and the dynamically available MCP tool names.

Client checks are interaction gates, not authorization. Core must independently enforce ownership, the effective MCP snapshot, read-only Query annotations, conversation permission/confirmation policy, OAuth isolation, cancellation, timeouts and mutation idempotency. Mutation operation IDs are stable across the HTTP authentication retry. Credentials and tool execution stay in Core; no browser-to-MCP fallback is present.
