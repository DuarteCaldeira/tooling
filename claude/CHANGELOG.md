# Changelog

Plugin `core@dcaldeira`. Bump `version` in `.claude-plugin/plugin.json` with every entry.

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
