# Bundled built-in skill additions

These assets supplement the official AionCore skill corpus. Vite includes them in the renderer's static output; Electron also copies `public/` into its resources directory. The desktop, standalone WebUI, web CLI, and Docker entry points pass the bundled directory to the shared backend lifecycle manager.

Each addition belongs under `auto-inject/<name>/` with its `SKILL.md`, license, and provenance. Only bundled additions are installed; official skills and user imports remain in their existing locations. See [Humanizer-zh](auto-inject/humanizer-zh/README.md).
