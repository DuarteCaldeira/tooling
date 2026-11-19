# Claude Code plugin

This repository is also a Claude Code marketplace (`dcaldeira`) with one plugin, `core`, in [`claude/`](../claude). It gives every React/Vite and Expo project the same rules, skills, agents and hooks. It is not part of the npm package.

## What it contains

| Part                                                                  | Purpose                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core-rules.md`                                                       | Short always-on rules, injected at session start and into every subagent, with the detected stack                                                                                                               |
| `skills/react-conventions`, `expo-conventions`, `backend-conventions` | Stack conventions, loaded when relevant                                                                                                                                                                         |
| `skills/workflow`                                                     | Branch → plan → implement → `tooling` → commit → PR                                                                                                                                                             |
| `skills/repo-standard`, `adopt-repo`                                  | The standard repo layout and how to bring a repo in line                                                                                                                                                        |
| `agents/planner`, `reviewer`, `tester`                                | Read-only planning and review; test writing                                                                                                                                                                     |
| `hooks/guard.mjs`                                                     | Blocks Edit/Write and shell writes (`>`, `tee`, `sed -i`, `cp`/`mv`, `Set-Content` …) to `.env*` (not `.env.example`), lockfiles, `dist/`, `coverage/`                                                          |
| `hooks/track-edit.mjs`                                                | Records each file Claude edits, with Edit/Write or a shell command (files changed while the command ran)                                                                                                        |
| `hooks/stop-check.mjs`                                                | At the end of a turn where Claude edited files: formats them (repo's own Prettier + ESLint), then runs `tooling --profile=dev --changed --skip=format` when the tree changed, and sends failures back to Claude |

The Stop hook never touches files you changed yourself and skips turns where Claude edited nothing, or where the tree is unchanged since its last run. A failure blocks the stop; after Claude's fix it re-checks once, then tells Claude to verify by hand. Repos without `tooling.config.json` are checked with their `check` npm script, when `package.json` has one. A run that times out (default 240 s, `CORE_STOP_TIMEOUT_MS` to change it) is reported as not validated. Each run appends its duration to `.tooling/claude-stop.jsonl`; check it if turns feel slow.

Session context names the folders each stack lives in (for example `vite (dashboard/)`), so the stack skill and the frontend rules apply only there.

The guard is a guard rail, not a sandbox: a shell command can still write a protected file in ways it does not parse (a script, `node -e`).

## Install

Once per machine:

```text
/plugin marketplace add DuarteCaldeira/tooling
/plugin install core@dcaldeira
```

Per repository, commit `.claude/settings.json` so worktrees, cloud sessions and other machines load the same plugins. The exact blocks (every repo, plus the frontend additions) are in [`claude/skills/repo-standard/SKILL.md`](../claude/skills/repo-standard/SKILL.md).

| Plugin / skill                  | Used for                                                                                                                                                                                                                    | Enabled in                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `core`                          | Rules, conventions, hooks, agents                                                                                                                                                                                           | every repo                                                                                      |
| `mattpocock-skills`             | `tdd`, `pr`, `domain-modeling` in the workflow                                                                                                                                                                              | every repo                                                                                      |
| `ui-ux-pro-max`                 | UI/UX design for new screens, components and redesigns                                                                                                                                                                      | frontend repos                                                                                  |
| `taste-skill`                   | `design-taste-frontend` critique of the visual result                                                                                                                                                                       | frontend repos                                                                                  |
| `caveman`                       | Terse replies, `caveman-commit`                                                                                                                                                                                             | your own `~/.claude/settings.json` only: in a repo it would change every collaborator's replies |
| `core:design-motion-principles` | Motion and interaction design. Bundled in `core` (MIT, [kylezantos/design-motion-principles](https://github.com/kylezantos/design-motion-principles)) because upstream is not a marketplace; pinned by `claude/vendor.json` | with `core`                                                                                     |

## Adopt a repository

Ask Claude to "adopt this repo" (`core:adopt-repo`). Then set `"repoStandard": true` in `tooling.config.json`:

- `tooling doctor` adds the standard to its local checks;
- `tooling doctor --repo-standard` checks only the standard (`AGENTS.md` sections, `CLAUDE.md` being `@AGENTS.md`, `core` + `mattpocock-skills` enabled, plus the UI plugins when a workspace depends on React, Vite, Next or Expo, no `.ai/` kit or `ai-memory/`);
- the reusable `ci.yml` workflow runs `doctor --repo-standard` on every pull request, from the pinned tooling SHA.

Two opt-in checks back the no-duplication rule mechanically (see [configuration](configuration.md)): `duplication` (jscpd; only clones touching changed files fail, so existing copies never block a PR) and `styles.rules.layoutCss` (flex layout in component modules must use the layout primitive). Turn `layoutCss` on once a repo's existing layout CSS is migrated, or list the remaining files in `styles.layoutPaths`.

## Release

1. Change files under `claude/`.
2. Bump `version` in `claude/.claude-plugin/plugin.json` (the test suite fails otherwise) and add an entry to [`claude/CHANGELOG.md`](../claude/CHANGELOG.md).
3. Merge to `main`. Consumers update with `/plugin marketplace update dcaldeira`.

Check before merging:

```sh
claude plugin validate --strict claude
claude plugin validate --strict .
node --test tests/claude-plugin.test.mjs
claude plugin eval claude --runs 1   # skill triggering on fixture projects; uses your Claude credits
```

## Turn it off

`/plugin disable core@dcaldeira` for this machine, or set `"core@dcaldeira": false` in a repository's `.claude/settings.local.json`.
