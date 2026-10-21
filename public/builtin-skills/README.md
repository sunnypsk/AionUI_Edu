# Bundled built-in skill additions

These assets supplement the official AionCore skill corpus. Vite includes them in the standalone WebUI's static output. The WebUI and Docker entry points pass the bundled directory to the shared backend lifecycle manager.

Each addition belongs under `auto-inject/<name>/` with its `SKILL.md`, license, and provenance. Only bundled additions are installed; official skills and user imports remain in their existing locations. See [Humanizer-zh](auto-inject/humanizer-zh/README.md) and [teaching-design](auto-inject/teaching-design/README.md). `BUNDLED_AUTO_INJECT_SKILLS` in `packages/web-host/src/backend-launcher.ts` lists the shipped additions and their files.

## Teacher-edition defaults

The pinned [Core patch](../../packages/web-host/openui/core/openui.patch) owns the built-in catalog policy. The API's `is_auto_inject`, new-conversation snapshots and agent discovery share this policy; a skill's physical directory no longer determines its default by itself. Names and short descriptions are advertised by default, while bodies are loaded when needed. Teachers do not need to select a skill before describing their task.

| Default use                       | Skills                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| Teaching and Chinese writing      | `teaching-design`, `humanizer-zh`                                                           |
| Office documents                  | `officecli`, `officecli-docx`, `officecli-pptx`, `officecli-xlsx`                           |
| PDF, forms and academic documents | `pdf`, `officecli-word-form`, `officecli-academic-paper`                                    |
| Diagrams and data                 | `mermaid`, `officecli-data-dashboard`, `officecli-financial-model`                          |
| Specialized presentations         | `morph-ppt`, `morph-ppt-3d`, `officecli-pitch-deck`                                         |
| Application support               | `aionui-config`, `conversation-create`, `session-message`, `cron`, `aionui-troubleshooting` |

These are 20 built-in defaults. The existing conversation and assistant opt-outs still apply. `skill-creator`, `aionui-webui-setup` and `aionui-webui-public` remain available for explicit administrative tasks, without automatic injection. The two WebUI guides describe this standalone edition rather than the upstream desktop UI.

`x-recruiter`, `xiaohongshu-recruiter`, `moltbook`, `openclaw-setup`, `weixin-file-send` and `story-roleplay` are excluded from the built-in catalog and agent resolution, including stale global catalog rows after an upgrade. Their stored files and historical conversation data are not deleted. A user's own imported workflow with the same name is preserved and remains opt-in.

New conversations receive the new defaults after the updated Core starts. Existing conversations retain their saved skill snapshots; they are not silently rewritten. Skill availability does not install optional programs or guarantee that the agent will choose a particular workflow.
