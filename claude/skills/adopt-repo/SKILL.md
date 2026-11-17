---
name: adopt-repo
description: Bring an existing repository in line with the repo standard - rewrite AGENTS.md, set CLAUDE.md and .claude/settings.json, remove the old .ai kit and ai-memory. Use when asked to adopt, migrate, onboard or standardise a repo for the core plugin.
---

# Adopt a repo

Work on a branch (`chore/adopt-core-plugin`). Show the user the plan from step 1 before deleting anything.

## 1. Audit

Compare the repo with `core:repo-standard` and list:

- missing required files;
- `AGENTS.md` sections that are generic advice, duplicate a plugin skill, or reference `.ai/`;
- `.ai` (junction or folder), `ai-memory/`, other copies of the old kit;
- `CLAUDE.md` content other than `@AGENTS.md`;
- `.claude/settings.json` state; `.gitignore` gaps.

## 2. Keep what is real

Before deleting `ai-memory/` or trimming `AGENTS.md`, read them. Move anything still true and repo-specific:

- product behaviour → `docs/spec.md` or `docs/areas/<area>.md`;
- decisions and trade-offs → `docs/decisions/NNNN-title.md`;
- domain terms → `GLOSSARY.md`;
- hard rules → `AGENTS.md` Constraints.
  Drop task logs, plans and status notes.

## 3. Rewrite

- `AGENTS.md` in the standard shape. Keep the repo's facts (layout, commands, deltas, constraints) word for word where still true; delete what the stack skill already says.
- Record the layout primitive and app shell under Conventions: find them with `grep -rhoE "import \{[^}]*\bStack\b[^}]*\} from '[^']+'"` and the most-used shell component. If two `Stack`s are in use, name the one to keep and add the other's removal as a follow-up, not part of adoption.
- Count existing layout CSS (`grep -rl "display: flex" --include=*.module.scss`). Report the number; migrating it is a separate task.
- `CLAUDE.md` → `@AGENTS.md`.
- `.claude/settings.json` → merge the marketplace + `enabledPlugins` block.
- `.gitignore` → `.claude/settings.local.json`, `.claude/worktrees/`, `.ai`.
- `tooling.config.json` → add `"repoStandard": true` and a `duplication` section if the repo uses tooling. Turn on `styles.rules.layoutCss` only when the layout-CSS count from the audit is small enough to migrate now; otherwise propose that migration as its own task.

## 4. Remove

- `.ai`: if it is a junction/symlink, remove only the link (`cmd /c rmdir .ai` on Windows; never `rm -rf` through it). If a real folder, ask first.
- `ai-memory/` after step 2, with the user's OK.
- Scripts or docs that call `.ai/scripts/*`.

## 5. Verify

- `grep -rn "\.ai/" --exclude-dir=node_modules .` is empty.
- `npx tooling doctor` passes (if tooling is used).
- `npx tooling --profile=push --changed --bail` green.
- Summarise for the user: what moved where, what was deleted, anything you were unsure about.
