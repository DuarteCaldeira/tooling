# Changelog

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
