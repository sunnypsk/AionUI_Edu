# OpenUI local acceptance

Repair regression, 2026-10-20: `.cache/openui-qa/yuyu-openui-browser-75RIrR/report.json` passed all 19 browser checks, including a native image with empty final text, preview, a byte-identical 3 MiB PNG download and reload deduplication. `.cache/openui-qa/yuyu-openui-browser-ZiTVoZ/report.json` passed the configured Codex chart/form/MCP Query and follow-up turns. The full Vitest suite passed 5,409 tests with five skipped. These are local results; deployment validation is separate.

Validation snapshot: 2026-10-19, macOS arm64. Browser report: `.cache/openui-qa/yuyu-openui-browser-1h61LN/report.json` (18 checks); configured-agent report: `.cache/openui-qa/yuyu-openui-browser-7cPO2f/report.json` (two completed agent turns). These results describe local checks; Linux containers, CI and deployment have not been validated.

| Check                                          | Result                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Production frontend build                      | Passed                                                                                                    |
| Full Vitest suite                              | 5,317 passed, 5 skipped                                                                                   |
| Official component fixtures                    | All 82 full-library and 84 chat-library entries covered                                                   |
| Root TypeScript and build/QA script typechecks | Passed                                                                                                    |
| Lint, formatting and i18n checks               | Passed; existing lint warnings remain                                                                     |
| Patched Core release build                     | `0.2.2-edu.openui.1`, Rust 1.95.0                                                                         |
| Affected Core crate suites                     | 2,510 passed, 6 ignored; serialized doctest compilation passed                                            |
| Core OpenUI HTTP integration                   | 3 passed, including authentication, CSRF, ownership, revisions, confirmations, durable replay and prompts |
| Real MCP transport/OAuth fixtures              | 9 passed across stdio, legacy SSE and Streamable HTTP, including cancellation and revocation              |
| Strict Core Clippy and Rust formatting         | Passed                                                                                                    |
| Source archive/patch replay                    | 1,439 source files matched the working source                                                             |
| Real configured Codex                          | Generated chart, form and MCP Query; submitted form reached a second completed agent turn                 |
| Database upgrade                               | A migration-43 conversation, original message, Unicode attachment and preference survived migration 44    |
| Humanizer-zh                                   | Still listed by Core as an automatically injected skill                                                   |
| Docker startup/restart persistence             | Blocked: the local daemon did not answer a six-second read-only probe                                     |

The browser runner uses a real authenticated WebUI, isolated temporary accounts/database, real Core and a durable fixture MCP write counter. Two Chrome contexts exercise account isolation, unsent form restoration, focus/reload, navigation flush, revision conflicts/reapply, editable-table drafts/reset, all control/input types, Query/Mutation confirmation and refresh, fork/delete, streaming gates and invalid-block repair. Desktop and touch/mobile viewports cover light/dark themes, date/select portals and modal focus loops, focus restoration and nested popovers. The second context uses a different timezone to check calendar-date preservation. Mobile validation uses Chrome emulation, not a physical phone or Safari.

Run after building the custom Core and production frontend:

```sh
bun run openui:qa
AIONUI_QA_AGENT_ONLY=1 bun run openui:qa
```

The agent command uses the configured native Codex account and model. It sends only a fixture task and uses the test conversation's MCP server. `AIONUI_QA_AGENT=1` runs both browser and agent scenarios in one invocation. `AIONUI_QA_CHROME` selects a Chrome executable. Each invocation records `report.json`, screenshots and generated agent programs under `.cache/openui-qa/`; check the report's `ok` and `checks`, not merely the command's startup output. Temporary test databases can be removed after their server has stopped; reports/screenshots do not require retaining them.

The renderer uses both official registries and ThemeProvider from `@openuidev/react-ui`'s **root export**. The pinned subpath bundle owns a separate theme context, which leaves its body portals outside the root provider. The schemas/prompts remain identical to the generated manifest. Host adapters retain the official grid/calendar, add table draft persistence and keyboard date triggers, serialize calendar dates without a timezone, namespace field IDs across programs/portals, trap modal focus and raise its popovers above the overlay, and rebuild the runtime store when restoring a remote snapshot. These behaviors have focused regression tests.

Native CLI permission rules that Core cannot evaluate retain a host confirmation card for mutations; authoritative Core approval decisions and read-only/plan restrictions are enforced. The build emits chunk-size notices and the pinned upstream optional `Library.extend`/Zod `mergeDefs` export warning. The integration uses the fixed official registries rather than that extension API.

The MIT notices for all three OpenUI packages ship as `openui-license.txt` in the renderer distribution. No Electron OpenUI renderer, native mobile app, public deployment or CI result is implied by this local acceptance snapshot.

## Teacher request evaluation

`AIONUI_QA_EVAL=1 bun run openui:qa` sends ten fixed Chinese-subject teacher requests (`qa/eval.ts`) to the configured native Codex account, one conversation each (request 8 continues request 2). It records every reply, its OpenUI programs and the files the request produced, including generated images, as `evaluation.json` and one Markdown file per request. `AIONUI_QA_EVAL_ONLY=03-illustration,07-plain` runs a subset. A request counts as finished after two quiet minutes with an idle runtime, because newer Codex versions split one request into several backend turns. Scoring against the design's success criteria is manual.

Baseline before the teacher components and guidance, 2026-10-21: `.cache/openui-qa/yuyu-openui-browser-EUkrju/` (`score.md`). Codex used OpenUI in 6 of 10 replies, all in Traditional Chinese. It planned before producing a file in 1 of 5 applicable requests, never showed file cards, and repeated prose inside a block in 2 replies. The run used the local Codex CLI 0.163.0 with the user's own Codex configuration and memory.
