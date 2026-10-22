# Humanizer-zh in AionUI_Edu

Vendored from [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh) at commit [`f4518a8eab97b8bfebc66a89d34320a89bef6930`](https://github.com/op7418/Humanizer-zh/tree/f4518a8eab97b8bfebc66a89d34320a89bef6930). The upstream skill revision is 2026-09-23. The original MIT [LICENSE](LICENSE) is included unchanged.

Upstream `SKILL.md` SHA-256: `95627fd4437d886f98032ccc62d79136e6310f1fc04e354bb86431795ff206df`.

## Local adaptations

- Shorten the description and expand the trigger to include Chinese drafting and ordinary Chinese replies.
- Add the `AionUI_Edu 自動套用規則` section before the upstream editing guidance. It applies the guidance to completed drafts, preserves the requested language (including Hong Kong Cantonese and Traditional Chinese), and protects facts, quotations, code, commands, paths, URLs, and structured data.
- Route long student-, parent- or colleague-facing Chinese text to the `argon` writing specialist when `aionui_specialists` is available, and leave specialist drafts unpolished so their wording is kept.
- Keep the remaining upstream front matter and editing guidance unchanged. No runtime download or third-party installer is used.

## Default enablement

The host copies this skill into AionCore's `builtin-skills/auto-inject/humanizer-zh/` after the official corpus is materialized. When content changes, the host restarts its newly started backend once on the same port so the database catalog includes the skill before the host reports ready. Unchanged content needs no additional restart. The restart is bounded, and an incomplete bundle fails startup instead of silently omitting the skill.

AionCore then includes it in new conversation skill snapshots through its normal auto-inject mechanism. The existing Skills selector and assistant defaults can exclude it. Existing conversations retain their saved skill snapshots. The upstream editing rules guide the model; they do not guarantee a particular response or an AI-detector result.
