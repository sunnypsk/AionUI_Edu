# teaching-design in AionUI_Edu

Authored in this repository for Hong Kong secondary Chinese Language teachers. It has no upstream source and no third-party content, and is covered by the repository's license.

## Purpose

The skill tells the agent how to make teaching materials (slides, tests and exam papers, worksheets, illustrations, marking criteria) and admin documents: ask only for missing details, show the plan as an editable OpenUI interface, produce the file only after the teacher confirms, and deliver each file with a `FileCard`. Its division-of-labour section tells Codex when to delegate lesson and curriculum design to the `opus` specialist, student-facing writing to the `argon` specialist, and what to keep for itself. It also records Chinese-subject conventions such as classical-text handling and DSE reading levels.

The always-on rules in `packages/desktop/src/common/openui/guidance.ts` reach every turn through the OpenUI manifest and point the agent to this skill. Keeping the detailed playbooks here lets them be tuned without rebuilding Core.

## Default enablement

Installed and enabled like [Humanizer-zh](../humanizer-zh/README.md): the host copies it into AionCore's `builtin-skills/auto-inject/teaching-design/`, restarts a newly started backend once when its content changes, and AionCore adds it to new conversation skill snapshots. The Skills selector and assistant defaults can exclude it. Existing conversations keep their saved snapshots.

Every `openui` example in `SKILL.md` is parsed against the extended component library by `tests/unit/skills/builtinSkills.test.ts`, so examples cannot drift from the component contracts.
