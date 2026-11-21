# Changelog

Plugin `core@dcaldeira`. Bump `version` in `.claude-plugin/plugin.json` with every entry.

## 0.2.6

- Evals: the `react-component` fixture uses vite 8.1.6 (was 8.0.0).

## 0.2.5

- Evals: the `reviewer` fixture uses vite 8.1.6 (was 8.0.0).

## 0.2.4

- Evals: the `supabase-migration` fixture uses vite 8.1.6 (was 8.0.0).

## 0.2.3

- Evals: the `scoped-stack` fixture uses vite 8.1.6 (was 8.0.0).

## 0.2.2

- Core rules: a review of a change to auth, money, personal data, API contracts or migrations goes to the `core:reviewer` agent. Before, the rule lived only in `core:workflow`, which a review request does not load.
- Evals `layout` and `motion` now grade what only the plugin teaches: i18n keys in every locale (a separate `layout` grader); the motion skill's frequency rule (no animation for a keyboard shortcut used dozens of times a day). Both passed without the plugin before. `scoped-stack` is labelled a no-harm guard (Δ 0 expected).
- Eval command uses `--judge-model sonnet`: the default haiku judge split its votes on correct answers (supabase-migration scored −0.50 with haiku, +0.50 with Sonnet).

## 0.2.1

- Evals: each case copies its `fixture/` into the run's working directory with a `scaffold.sh` (run with `--scaffold`). With `add_dirs` the agent got read access but was never told the fixture's path, so no case could read its project.
- Session start: when the git root has no `package.json`, the rules come from the nearest `package.json` instead of being skipped (a JS app in a subfolder of a non-JS repo, and eval runs, whose home is a git repo).

## 0.2.0

- Session context names the folders each stack lives in (`vite (dashboard/)`). The stack skill and the frontend rules apply only to files there, so other code in a monorepo no longer gets React conventions. The TypeScript rule applies to TypeScript code only.
- Stop hook validates only turns where Claude edited files: a question or review in a dirty tree no longer runs `tooling` on your own work.
- Stop hook re-checks a fix once after a failure, then tells Claude to run the command itself before claiming done (before, a fix was never re-checked).
- Stop hook falls back to the repo's `check` npm script when there is no `tooling.config.json`.
- Files Claude writes with shell commands (`sed`, heredocs, scripts) are tracked and formatted like Edit/Write.
- `reviewer` and `tester` read uncommitted and untracked changes, not only the branch diff. `reviewer` runs on Opus.
- Evals: `scoped-stack` (React rules stay out of plain-JS folders), `reviewer` (finds a planted pricing bug), `validate` (bug fix gets a regression test and a test run).

## 0.1.3

- Guard: file names are split on both `/` and `\`, so a Windows path is recognised on any OS. Fixes the Linux CI failure on `.env` paths like `C:\repo\.env.production`.

## 0.1.2

- Stop hook: a `tooling` run that hits the time limit is killed together with its children (test workers, `tsc`), so they no longer keep running and slow down later runs.

## 0.1.1

- Frontend-only rules (layout primitive, render/effects, i18n, design and motion skills, test queries) move to a `Frontend` section that is injected only when the repo depends on React, React Native, Expo, Vite or Next. Other repos get about a third less session context.
- Stack detection scans every top-level folder with a `package.json` (plus workspaces, `apps/*`, `packages/*`), so apps in folders like `dashboard/` are found. `tooling doctor --repo-standard` uses the same rule, so the plugin and the doctor agree on which repos are frontend repos.

## 0.1.0

- Core rules injected at session start and into every subagent, with the detected stack (vite, expo, next, supabase) and the skills to load.
- Skills: `react-conventions`, `expo-conventions`, `backend-conventions`, `workflow`, `repo-standard`, `adopt-repo`, and `design-motion-principles` (vendored, MIT, upstream commit `4a9ca879f24a`).
- Repos enable `mattpocock-skills` next to `core`, plus `ui-ux-pro-max` and `taste-skill` when they have a frontend; UI work loads `ui-ux-pro-max` + `design-taste-frontend`, motion work loads `design-motion-principles`.
- Layout primitive comes from `AGENTS.md` (default design-system `Stack`); reviewer judges only the diff; design skills only for new screens, components and redesigns, with the design system winning.
- Search-only subagents (Explore, claude-code-guide, locators) no longer get the rules injected.
- `caveman` stays in user settings; `ui-ux-pro-max` and `taste-skill` are required only in frontend repos.
- `vendor.json` pins the bundled skill's files; a test fails if they drift from upstream.
- No-duplication rule: layouts and shells are built from the design system's `Stack`, one shared app shell, repeated page frames become shared components (core rules, React and Expo conventions, reviewer checklist).
- Agents: `planner`, `reviewer`, `tester`.
- Guard: blocks Edit/Write and shell writes to `.env*` (not templates), lockfiles, `dist/`, `coverage/`.
- Stop hook: formats only the files Claude edited, runs `tooling --profile=dev --changed` when the tree changed, logs timings to `.tooling/claude-stop.jsonl`. Timeout via `CORE_STOP_TIMEOUT_MS` (default 240000).
