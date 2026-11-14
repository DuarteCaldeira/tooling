# Repository tooling

`@dcaldeira/repo-tooling` shares one check graph between development, push gates and reusable GitHub Actions workflows. Node 22.13 or later; npm workspaces; no paid service is required.

```sh
npm ci --ignore-scripts
npm test
npm run pack:tooling
```

Consumers install an exact public npm version, commit their lockfile and pin reusable workflows to the full commit SHA. The initial version is **0.1.0**. No package or repository credentials are embedded.

| Command                                                         | Purpose                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `repo-tooling --profile=dev --changed`                          | Changed formatting/lint/styles, related unit tests and relevant translations    |
| `repo-tooling --profile=push --changed --bail`                  | Every applicable check; records a reusable pass only for a clean unchanged tree |
| `repo-tooling --profile=ci --all`                               | Complete validation with prerequisites enforced                                 |
| `repo-tooling --profile=ci --changed --base=origin/main --plan` | Explain selection without running checks                                        |

See [setup](docs/setup.md), [configuration](docs/configuration.md), [release trust](docs/releases.md), [migration](docs/migration.md) and [troubleshooting](docs/troubleshooting.md). Rookie's configuration and adoption assets are in [examples/rookie](examples/rookie).

Docs select only formatting. Styles select formatting and style lint. Mixed changes use their union. Dependencies, shared tooling and unknown files broaden validation. Local push and hosted CI use the same definitions. Missing prerequisites, skipped required checks, failed dependencies and interrupted checks cannot record a pass.

The HTML summary links to Playwright's self-contained report, which contains expected/actual/diff images, scenario names, viewports, browser details and traces. Reports are retained for three days in Actions.

MIT licensed. Public publishing requires GitHub/npm credentials or npm trusted publishing to be configured by the owner. Local preparation alone does not publish anything.
