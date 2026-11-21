# Setup

For a new React/Vite consumer, install the published package and scaffold the adapters:

```sh
npm install --save-dev --save-exact @dcaldeira/tooling@0.2.1
npx tooling init --preset=react-vite --tooling-sha=FULL_40_CHARACTER_COMMIT_SHA
npm install
npx tooling doctor
```

Use `--preset=workspace --app=frontend` (or `--app=apps/web`) when the app is nested. The root remains responsible for formatting and the shared lockfile. Initialization preserves existing scripts, Prettier configuration and `.nvmrc`; it refuses to overwrite generated configuration, hooks or workflows. The initial checks are formatting, lint, types, unit coverage and build. Enable optional capabilities in `tooling.config.json` as you add their prerequisites. Small examples are in `examples/react-vite` and `examples/workspace`.

Install the peer tools used by those checks: Prettier, ESLint and its preset plugins, TypeScript, Vitest and the matching `@vitest/coverage-v8` version. Extend the shared configs or keep your existing application configs. `tooling doctor` validates configuration, the check graph, executables, npm script adapters, hook setup and workflow pins without running checks. It reports Linux-only checks as notices on Windows. Enable the generated hook with `git config core.hooksPath .githooks`.

1. Publish the public repository as `DuarteCaldeira/tooling` and release `@dcaldeira/tooling@0.2.1` publicly. For the first publication, configure npm trusted publishing or an npm automation token. Releases run through the **Release tooling package** workflow (`package-release.yml`): it runs tests, checks the version against the lockfile, tags the commit, creates the GitHub release and publishes with provenance.
2. Install `npm install --save-dev --save-exact @dcaldeira/tooling@0.2.1`. Commit `package-lock.json`. While publication is pending, install the checked-in pilot tarball from `tools/` instead. It contains the same versioned package.
3. Copy and adapt `examples/rookie/tooling.config.json`. Commit it in the consumer root. Add `.tooling/` to Git and formatting ignores.
4. Keep command names, with `check:dev`, `check:push` and `ci:local` invoking the shared binary. Keep application commands in config as adapters; never make a check call its own runner alias.
5. Copy `packages/tooling/templates/pre-push` to `.githooks/pre-push`, make it executable on Linux and set `git config core.hooksPath .githooks`. The hook automatically validates; it accepts no release-branch shortcut and validates the actual pushed HEAD. Deletions do not need validation. It fails closed for a different ref.
6. Copy consumer CI, Dependabot and merge workflow templates. Replace `REPLACE_WITH_TOOLING_COMMIT_SHA` with the actual 40-character commit SHA in **both** the workflow reference and `tooling-sha` input. Never use `main` or a version tag in consumer workflow references.
7. Where repository rulesets are available, require `CI / result`, require branches to be up to date and restrict direct pushes. On GitHub Free private repositories, check the current plan's protection capabilities; merge automation explicitly inspects all current statuses rather than relying on auto-merge without rules.

No workflow-level path filtering is used. PRs run on opening and every subsequent revision. Superseded runs are cancelled. Manual and weekly full validation remain available. Read-only PR jobs never receive publishing or deployment secrets.

## Presets

Import `@dcaldeira/tooling/configs/prettier.mjs`. Extend `configs/tsconfig.json`, merge the plain Vitest/Playwright defaults with your own configuration and extend the ESLint flat config with your application's import boundaries. Install the peer tools you actually use; unused optional peers are not installed. Knip's JSON preset uses its `extends` support.

The SCSS checker defaults to the `standard` preset. Select `styles.preset: "rookie"` to retain Rookie's BEM, component-name and palette rules. Source paths, nesting depth, specificity, rule switches and token-definition paths are configurable. Rookie's extra common-import, inline-style and media-query rules stay in its application adapter.

## Lightweight documentation CI

The reusable workflow always plans before installation. Set `with.lightweight-docs: true` in the caller to opt into standalone formatter installation when your Prettier configuration is self-contained or imports only the shared tooling preset. Keep this off when it imports project dependencies or uses plugins. Initialization enables it when it generates the shared formatter preset; preserved formatter integrations and the generic workflow template leave it disabled.

Only an unmodified built-in formatting command, a docs-only plan and a locked standalone Prettier package qualify. CI copies the exact version, resolved URL and integrity from the consumer lockfile into an isolated installation, and makes the formatter/shared preset resolvable. Custom formatting adapters, mixed changes and incompatible lock entries use the normal full installation. Formatting still uses the consumer's config and ignore rules.

## Linux validation

Canonical browser screenshots and Lighthouse timings run on Ubuntu 24.04. Use WSL or a matching Linux container locally. Missing Linux/browser/backend tooling is an **unavailable** result, never a success. `--all` broadens selection; it does not waive platform requirements.

Hosted provisioning uses the selected plan: PostgreSQL 16/pgTAP only for database checks, pinned Deno/Lighthouse versions and pinned actionlint/gitleaks containers only when needed. Browser versions come from the consumer's Playwright lockfile. `--install` performs `npm ci --ignore-scripts` (`pnpm install --frozen-lockfile --ignore-scripts` in a pnpm repository, see [migration](migration.md)); install external prerequisites explicitly before running local CI.

Workspace scaffolding now declares the app and shared-source relationship explicitly. For multiple applications, adapt `examples/multi-workspace/tooling.config.json`; use scoped aliases of built-in checks instead of copying their command definitions. Browser installation and ESLint tool-cache restoration are shared by PR and release validation. See the incremental-validation section of [configuration](configuration.md) for result-cache controls and opt-in TypeScript metadata persistence.

See [project features](project-features.md) to configure architecture rules, rendered accessibility routes and dependency consistency. Install TypeScript for source import analysis and add Playwright/axe only when enabling accessibility. Generated component/hook tests require React, Vitest, jsdom and Testing Library in the target app. Keep authenticated browser state ignored; the runner fingerprints it automatically when configured for accessibility. Existing applications can supply their JSON result paths through `reporting` without replacing their reporters.
