# Repository tooling

`@dcaldeira/tooling` shares one check graph between development, push gates and reusable GitHub Actions workflows. Node 22.13 or later; npm workspaces; no paid service is required.

```sh
npm ci --ignore-scripts
npm test
npm run pack:tooling
```

Consumers install an exact public npm version, commit their lockfile and pin reusable workflows to the full commit SHA. The initial version is **0.1.0**. No package or repository credentials are embedded.

| Command                                                    | Purpose                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `tooling --profile=dev --changed`                          | Changed formatting/lint/styles, related unit tests and relevant translations    |
| `tooling --profile=push --changed --bail`                  | Every applicable check; records a reusable pass only for a clean unchanged tree |
| `tooling --profile=ci --all`                               | Complete validation with prerequisites enforced                                 |
| `tooling --profile=ci --changed --base=origin/main --plan` | Explain selection without running checks                                        |

See [project features](docs/project-features.md), [setup](docs/setup.md), [configuration](docs/configuration.md), [release trust](docs/releases.md), [migration](docs/migration.md) and [troubleshooting](docs/troubleshooting.md). Rookie's configuration and adoption assets are in [examples/rookie](examples/rookie).

Use `tooling init --preset=react-vite` or `tooling init --preset=workspace --app=frontend` to scaffold a consumer, then `tooling doctor` to check its setup. Pass `--tooling-sha=<40-character SHA>` to pin generated workflows. Templates ship inside the npm package.

Independent checks run with bounded concurrency and shared-resource locks. `--concurrency=1` runs sequentially. Development watch mode responds to filesystem events, with ignored generated files filtered out. Functional and visual browser suites are disjoint by default. Documentation CI can opt into a locked standalone formatter installation.

Workspace scopes follow declared shared-code dependencies, and deterministic diagnostics reuse successful results by their inputs. ESLint uses persistent content caches; noEmit TypeScript projects can opt into CI metadata persistence. Full validation with `--all` bypasses diagnostic success records, and `--no-cache` disables runner-managed reuse. Empty plans avoid installation and reports. Browser provisioning is shared by PR and release workflows and includes Lighthouse-only projects.

Docs select only formatting. Styles select formatting and style lint. Mixed changes use their union. Dependencies, shared tooling and unknown files broaden validation. Local push and hosted CI use the same definitions. Missing prerequisites, skipped required checks, failed dependencies and interrupted checks cannot record a pass.

The HTML summary links to Playwright's self-contained report, which contains expected/actual/diff images, scenario names, viewports, browser details and traces. Reports are retained for three days in Actions.

MIT licensed. Public publishing requires GitHub/npm credentials or npm trusted publishing to be configured by the owner. Local preparation alone does not publish anything.

Opt-in architecture, rendered accessibility and dependency-consistency checks share the same runner. Use `tooling generate component --name=UserCard` or `tooling generate hook --name=useProfile` for typed scaffolds, and `tooling history` for recent validation performance. PR/release workflows publish an Actions summary with report artifacts.

The [app release dashboard](docs/apps-dashboard.md) tracks application versions, tooling versions and release dates, with Vercel hosting and automatic runtime updates without release-triggered builds. Manage its app list in [dashboard/apps.json](dashboard/apps.json).

See [shared preview, package and visual helpers](docs/shared-scripts.md) for reusable library and browser-test scripts.

The repository is also the `dcaldeira` Claude Code marketplace. Its `core` plugin ([docs](docs/claude-plugin.md)) shares rules, skills and validation hooks across projects:

```text
/plugin install core --marketplace DuarteCaldeira/tooling
```
