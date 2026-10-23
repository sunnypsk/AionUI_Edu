# teaching-design in AionUI_Edu

Authored in this repository for Hong Kong secondary Chinese Language teachers. It has no upstream source and no third-party content, and is covered by the repository's license.

## Purpose

The skill tells the agent how to make teaching materials (slides, tests and exam papers, worksheets, illustrations, marking criteria) and admin documents: ask only for essential missing details and produce files directly when format and quantity are specified, the task has at most 10 short items, or planning was waived. Other tasks use an editable OpenUI plan before production. Small quizzes need no planning specialist; longer design and prose still follow the `opus` and `argon` roles. Deliver each file with a `FileCard`, and describe work and results without exposing internal skill names in replies, progress updates, or generated UI labels. These rules are also reflected in the always-on OpenUI guidance.

The always-on rules in `packages/desktop/src/common/openui/guidance.ts` reach every turn through the OpenUI manifest and point the agent to this skill. Keeping the detailed playbooks here lets them be tuned without rebuilding Core.

## Default enablement

Installed and enabled like [Humanizer-zh](../humanizer-zh/README.md): the host copies it into AionCore's `builtin-skills/auto-inject/teaching-design/`, restarts a newly started backend once when its content changes, and AionCore adds it to new conversation skill snapshots. The Skills selector and assistant defaults can exclude it. Existing conversations keep their saved snapshots.

Every `openui` example in `SKILL.md` is parsed against the extended component library by `tests/unit/skills/builtinSkills.test.ts`, so examples cannot drift from the component contracts.
