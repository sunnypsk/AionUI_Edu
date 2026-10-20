---
name: architecture
description: |
  Project architecture and file structure conventions for all process types.
  Use when: (1) Creating new files or modules, (2) Deciding where code should go,
  (3) Converting single-file components to directories, (4) Reviewing code for structure compliance,
  (5) Adding new adapters, services or host runtime modules.
---

# Architecture Skill

Determine correct file placement and runtime boundaries for the standalone WebUI.

## Detailed References

- **Renderer layer** (components, hooks, utils, pages, CSS): [references/renderer.md](references/renderer.md)
- **Host and shared layer** (HTTP/WebSocket services and contracts): [references/process.md](references/process.md)
- **Project root & monorepo layout** (directory structure, migration status): [references/project-layout.md](references/project-layout.md)

---

## File Placement and Runtime Boundaries

This fork is WebUI-only. The legacy `packages/desktop` directory contains frontend/shared source, not an Electron app or workspace.

- Browser components, hooks, pages and styles: `packages/desktop/src/renderer/`.
- Shared frontend types, HTTP/WebSocket adapters and browser-safe utilities: `packages/desktop/src/common/`.
- Server/runtime APIs and browser gateway: `packages/web-host/src/`.
- Pinned Core builds and OpenUI artifacts: `packages/web-host/openui/`.
- NAS release, rollback and container tests: `packages/web-host/docker/`.

Host code may use Node/Bun APIs but not the DOM. Renderer code may use browser APIs but not Node or Electron. Cross-layer calls go through the existing HTTP/WebSocket adapters. Do not add source to the removed process, preload, worker or native mobile layers.

## Naming Conventions

### Directories

| Scope                              | Convention | Reason                                                  |
| ---------------------------------- | ---------- | ------------------------------------------------------- |
| **Renderer** component/module dirs | PascalCase | React convention — dir name = component name            |
| **Everything else**                | lowercase  | Node.js convention                                      |
| **Categorical dirs** (everywhere)  | lowercase  | `components/`, `hooks/`, `utils/`, `services/`          |
| **Platform dirs** (everywhere)     | lowercase  | `acp/`, `codex/`, `gemini/` — cross-process consistency |

> Quick test: "Inside `packages/desktop/src/renderer/` AND represents a specific component/feature (not a category)?" → PascalCase. Otherwise → lowercase.

### Files

| Content                   | Convention                      | Examples                              |
| ------------------------- | ------------------------------- | ------------------------------------- |
| React components, classes | PascalCase                      | `SettingsModal.tsx`, `CronService.ts` |
| Hooks                     | camelCase with `use` prefix     | `useTheme.ts`, `useCronJobs.ts`       |
| Utilities, helpers        | camelCase                       | `formatDate.ts`, `cronUtils.ts`       |
| Entry points              | `index.ts` / `index.tsx`        | Required for directory-based modules  |
| Config, types, constants  | camelCase                       | `types.ts`, `constants.ts`            |
| Styles                    | kebab-case or `Name.module.css` | `chat-layout.css`                     |

---

## Structural Rules

1. **Directory size limit**: Max **10** direct children. Split into subdirectories by responsibility when approaching.
2. **No single-file directories**: Merge into parent or related directory.
3. **Single file vs directory**: If a component needs a private sub-component or hook, convert to a directory with `index.tsx`.
4. **Page-private first**: Start code in `pages/<PageName>/`. Promote to shared only when a second consumer appears.

## Test File Mapping

Tests mirror source files in `tests/` subdirectories:

| Source                                                    | Test                                                 |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `packages/web-host/src/browser.ts`                        | `packages/web-host/tests/browser.test.ts`            |
| `packages/desktop/src/renderer/hooks/ui/useAutoScroll.ts` | `tests/unit/useAutoScroll.dom.test.ts`               |
| `packages/web-host/src/static-server.ts`                  | `packages/web-host/tests/static-server.unit.test.ts` |

When `tests/unit/` exceeds 10 direct children, group into subdirectories matching source structure.

---

## Quick Checklist

- [ ] Code is in the correct process directory (no cross-process imports)
- [ ] Renderer code does not use Node.js APIs
- [ ] Host code does not use DOM APIs
- [ ] Server calls use the HTTP/WebSocket gateway
- [ ] Renderer component/module dirs use PascalCase; categorical dirs use lowercase
- [ ] Platform dirs use lowercase everywhere
- [ ] Directory-based modules have `index.tsx` / `index.ts` entry point
- [ ] Page-private code is under `pages/<PageName>/`, not in shared dirs
- [ ] No single-file directories
- [ ] No directory exceeds 10 direct children
- [ ] New source files are auto-included in coverage — verify they are not accidentally excluded in `vitest.config.ts` → `coverage.exclude`
- [ ] New services separate pure logic from IO
