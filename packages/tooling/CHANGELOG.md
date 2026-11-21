# Changelog

## 0.3.0

- pnpm support. The package manager is the `packageManager` field of the root `package.json`, else `pnpm-lock.yaml`, else npm; npm repositories behave exactly as before.
- In a pnpm repository the runner rewrites `npm run …` and `npm audit` commands (built-in `build`, `size`, `security` and adapters written by `tooling init`) to pnpm, `--install` runs `pnpm install --frozen-lockfile --ignore-scripts`, `checks/package.mjs` runs `pnpm pack`, and the validation-pass fingerprint reads `node_modules/.pnpm/lock.yaml`.
- `checks/audit.mjs` runs `pnpm audit --json` (`--prod` for the production pass) and reads its advisory report; the allowlist behaves as with npm.
- `tooling init` writes pnpm commands into the config and `pre-push` hook, and `tooling doctor` checks for `pnpm-lock.yaml` and pnpm scripts.
- `ci.yml` and `release-validation.yml` set up pnpm (`pnpm/action-setup`, version from `packageManager`) and install with `pnpm install --frozen-lockfile --ignore-scripts` when `pnpm-lock.yaml` exists. Playwright versions for the browser cache and duplicate-version detection are read from `pnpm-lock.yaml`.
- The standalone formatter install (`lightweight-docs`) stays npm-only; pnpm repositories use the full install. `pnpm-lock.yaml` and `pnpm-workspace.yaml` count as dependency files for change detection.

## 0.2.2

- No changes to the package's code, configs or templates since 0.2.1. This release tags the current `main`, which adds release dashboard and plugin updates outside the package.

## 0.2.1

- `budgets.bundle.files`: `[path part, label, KB]` allowances for files with no source map, such as a pre-built map worker, which otherwise count against `chunkKB`.

## 0.2.0

- `repoStandard` option and `tooling doctor --repo-standard`: AGENTS.md sections, CLAUDE.md, `.claude/settings.json` plugins (UI plugins only for frontend repos), no `.ai` kit or `ai-memory`. The reusable `ci.yml` runs it when enabled.
- Opt-in `duplication` check (jscpd): in every profile only clones touching changed files fail; `--all` runs report existing clones without failing; `duplication.scope: "all"` makes every clone fail. It fails when none of `duplication.paths` exist (for example the default `src` in a monorepo) instead of passing without scanning.
- Releases run only through `package-release.yml`; the tag-triggered `publish-npm.yml` is removed, so every published version passes the semver and lockfile checks.
- `styles.rules.layoutCss` and `styles.layoutPaths`: report flex layout in component modules so layouts use the shared `Stack`.

## 0.1.0

Initial release of `@dcaldeira/tooling`.

- Shared validation graph for development, push checks and GitHub Actions, with bounded concurrency and prerequisite/resource handling.
- Changed-file and workspace-aware check selection, diagnostic caching, watch mode and validation reports.
- Project setup, diagnostics and typed React component/hook generators.
- Shared checks for SCSS/Sass, accessibility, architecture, dependency consistency, translations, bundle size, secrets and npm advisories.
- Reusable CI and release validation workflows, release evidence verification and finalization helpers.
- Correct failure handling for npm audit responses and SCSS autofixes, decoded service-role JWT detection, and reusable module-resolution caches.
