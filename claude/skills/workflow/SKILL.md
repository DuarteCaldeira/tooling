---
name: workflow
description: The delivery workflow for every change - branch, plan, implement, validate with @dcaldeira/tooling, commit, push, PR. Use when starting a task that changes code, before committing or pushing, or when asked how work should flow.
---

# Workflow

## 1. Branch

- Never commit to `main`. Branch from an up-to-date `origin/main`: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- One concern per branch. Unrelated work found on the way becomes a separate task, not part of this diff.

## 2. Understand

- Read `AGENTS.md`, the area doc in `docs/` for what you touch, and the code you will change.
- Unclear requirement or a choice only the user can make: ask before writing code.
- Medium or larger task: write the plan (files, steps, how you will verify) before editing. Use the `planner` agent for cross-boundary work.

## 3. Implement

- Smallest change that meets the request. Follow the stack skill (`core:react-conventions`, `core:expo-conventions`, `core:backend-conventions`).
- Test-first for bugs and logic: failing test, fix, green (`mattpocock-skills:tdd`).
- Behaviour change → update the spec / area doc in `docs/` in the same change. Trade-off worth remembering → short ADR in `docs/decisions/`.
- User-visible change → changelog / "what's new" entry if the repo keeps one.

## 4. Validate

- While working: `tooling --profile=dev --changed` (the Stop hook also runs it).
- Before pushing: commit everything, then `tooling --profile=push --changed --bail` (or `npm run check:push`). Run it in the background; it can take minutes. Done only when it prints a recorded pass.
- Repos without tooling: run lint, typecheck, unit tests and build scripts.
- Report what you could not run. Never use `--no-verify`; that is for the human alone.

## 5. Commit

- Conventional Commits (`type(scope): summary`), imperative, intent over mechanics. `caveman:caveman-commit` writes one when the user has caveman enabled.
- One logical change per commit. Never commit secrets, `.env`, build output or coverage.

## 6. Pull request

- Push the branch, open a PR against `main`. Body: what and why, how verified, risks (`mattpocock-skills:pr`).
- Large, cross-boundary or risky (auth, data, contracts, migrations) → run the `reviewer` agent first and address findings.
- Merge only when CI is green. The user merges unless they said otherwise.
