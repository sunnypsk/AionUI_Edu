# File structure

The project ships the Unraid WebUI. Local macOS development uses the same standalone browser/server path.

## Placement

| Purpose                                              | Location                         |
| ---------------------------------------------------- | -------------------------------- |
| React components, hooks, pages, CSS and i18n         | `packages/desktop/src/renderer/` |
| Shared browser contracts and HTTP/WebSocket adapters | `packages/desktop/src/common/`   |
| Server, Core lifecycle and runtime controls          | `packages/web-host/src/`         |
| OpenUI assets, pinned Core build and browser QA      | `packages/web-host/openui/`      |
| Container releases, NAS updater and rollback tests   | `packages/web-host/docker/`      |
| Shared unit/integration tests and browser E2E        | `tests/`                         |

`desktop` is a retained source directory name, not a workspace or native app. Do not recreate process/preload/native mobile directories or installer packaging.

## Structure and naming

Prefer at most 10 direct children per directory. New or substantially reorganized directories must satisfy this limit. Avoid single-file directories. Existing violations do not require unrelated cleanup, but a change must not make them worse.

React component files and component-specific directories use PascalCase. Hooks use camelCase with a `use` prefix. Utilities, constants and type files use camelCase. General directories and platform identifiers use lowercase. Styles use kebab-case or `ComponentName.module.css`.

Keep page-private code with its page; promote it to shared components only when a second consumer exists. A directory-based component needs an `index.tsx` entry point. Tests should mirror the affected source behavior rather than asserting implementation details.

## Runtime boundaries

The host may use Node/Bun APIs but no DOM. The renderer may use browser APIs but no Node.js APIs. Shared runtime imports reached by the renderer must be browser-safe. Server operations use the existing HTTP/WebSocket adapters; the historical `ipcBridge` export name does not imply an Electron dependency.

Keep global styles under the renderer styles directory; prefer UnoCSS utilities, CSS Modules and semantic color tokens. New UI uses Arco components, IconPark icons and i18n keys.
