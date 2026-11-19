# tooling

Shared check runner (`@dcaldeira/tooling`, public on npm), reusable GitHub Actions workflows, an app release dashboard, and the `dcaldeira` Claude Code marketplace with the `core` plugin.

## Repository

- Stack: Node ≥ 22.13 ESM (`.mjs`, no build step, no TypeScript in the runner); `node --test` for tests; dashboard is React 19 + Vite on Vercel.
- Package manager: npm workspaces (`packages/tooling` only); the dashboard has its own `package-lock.json` (`npm --prefix dashboard`). Node version in `.nvmrc`.
- Public: the npm package, this GitHub repo and the plugin are public. No personal paths, names or secrets in any file.

## Layout

| Path                         | Holds                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/tooling/runner`    | CLI (`cli.mjs`), check graph, change detection, cache, `init`/`doctor` (`setup.mjs`)     |
| `packages/tooling/checks`    | Built-in check implementations (bundle, sass, a11y, secrets, translations, visual …)     |
| `packages/tooling/configs`   | Shared ESLint, Prettier, Vitest, Playwright, tsconfig, knip configs for consumers        |
| `packages/tooling/templates` | Files `tooling init` writes into consumers (`ci.yml`, `pre-push`, dependabot)            |
| `packages/tooling/release`   | Release evidence and signing                                                             |
| `.github/workflows`          | `ci.yml` / `release.yml` are reusable workflows consumers pin by SHA; `test.yml` is ours |
| `dashboard/`                 | App release dashboard (Vercel)                                                           |
| `claude/`                    | Claude Code plugin `core`: hooks, skills, agents, evals ([docs](docs/claude-plugin.md))  |
| `.claude-plugin/`            | Marketplace manifest (`dcaldeira`)                                                       |
| `tests/`                     | `*.test.mjs` (node:test) and `*.browser.mjs` / `*.integration.mjs` (Playwright)          |
| `docs/`                      | User docs for consumers                                                                  |

## Commands

| Purpose       | Command                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| unit tests    | `npm test`                                                                                                                                                                                                                           |
| formatting    | `npm run format:check`                                                                                                                                                                                                               |
| browser tests | `npm run test:browser` (needs Playwright browsers)                                                                                                                                                                                   |
| package       | `npm run pack:tooling`                                                                                                                                                                                                               |
| plugin        | `claude plugin validate --strict claude && claude plugin validate --strict .`                                                                                                                                                        |
| plugin evals  | `claude plugin eval claude --runs 1` (uses Claude credits; each case runs with and without the plugin). The `validate` case needs `--allow-tools Bash Edit Write`, which works only on Linux/macOS (shell tools need the OS sandbox) |

## Tests per area

Run the file for the area you change (`node --test tests/<file>`), then `npm test`.

| Area                                                       | Test files                                                                                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runner/` CLI, config, plan, execution                     | `cli`, `graph`, `execute`, `incremental`, `git`, `optimizations`                                                                                                                        |
| `checks/`                                                  | `checks-regression`, `sass`, `translations`, `shared-scripts`, `features`; `a11y.integration` (browser)                                                                                 |
| `release/`                                                 | `release`, `github-release`                                                                                                                                                             |
| `claude/` hooks, `repo-standard`, `doctor --repo-standard` | `claude-plugin`                                                                                                                                                                         |
| `.github/workflows`, `templates/`                          | `workflows`                                                                                                                                                                             |
| `dashboard/`                                               | `dashboard`, `dashboard-runtime`, `dashboard-vercel`, `dashboard-overlay`, `discussions`, `release-notes`; `dashboard.browser`, `dashboard-runtime.browser`, `dashboard-mobile.browser` |

## Conventions

- Runner code is plain ESM JavaScript with JSDoc where a type matters; no dependencies beyond `devDependencies` in the root `package.json`.
- Every behaviour change gets a `tests/*.test.mjs` case built from temp-dir fixtures (`mkdtempSync`), never the real repo.
- Consumers pin exact versions: a runner or schema change needs a version bump in `packages/tooling/package.json` and a `packages/tooling/CHANGELOG.md` entry before it reaches them. Reusable workflows reach them through the pinned SHA.
- A change under `claude/` bumps `claude/.claude-plugin/plugin.json` and adds a `claude/CHANGELOG.md` entry (a test enforces the bump).
- Windows and Linux both run CI (`test.yml` matrix): spawn tools with argument arrays, never shell strings; quote paths with spaces.

## Constraints

- Never embed credentials; publishing to npm and GitHub releases is done by the owner.
- Breaking changes to `tooling.config.json`, CLI flags or workflow inputs need a migration note in `docs/migration.md`.
- `.github/workflows/ci.yml` and `release.yml` run in consumer repos: keep them free of repo-specific assumptions.
