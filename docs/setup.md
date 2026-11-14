# Setup

1. Publish the public repository as `DuarteCaldeira/repo-tooling` and release `@dcaldeira/repo-tooling@0.1.0` publicly. For the first publication, configure npm trusted publishing or an npm automation token. The supplied npm publishing workflow runs tests and verifies the tag/version before publishing with provenance.
2. Install `npm install --save-dev --save-exact @dcaldeira/repo-tooling@0.1.0`. Commit `package-lock.json`. While publication is pending, install the checked-in pilot tarball from `tools/` instead. It contains the same versioned package.
3. Copy and adapt `examples/rookie/repo-tooling.config.json`. Commit it in the consumer root. Add `.repo-tooling/` to Git and formatting ignores.
4. Keep command names, with `check:dev`, `check:push` and `ci:local` invoking the shared binary. Keep application commands in config as adapters; never make a check call its own runner alias.
5. Copy `templates/pre-push` to `.githooks/pre-push`, make it executable on Linux and set `git config core.hooksPath .githooks`. The hook automatically validates; it accepts no release-branch shortcut and validates the actual pushed HEAD. Deletions do not need validation. It fails closed for a different ref.
6. Copy consumer CI, Dependabot and merge workflow templates. Replace `REPLACE_WITH_TOOLING_COMMIT_SHA` with the actual 40-character commit SHA in **both** the workflow reference and `tooling-sha` input. Never use `main` or a version tag in consumer workflow references.
7. Where repository rulesets are available, require `CI / result`, require branches to be up to date and restrict direct pushes. On GitHub Free private repositories, check the current plan's protection capabilities; merge automation explicitly inspects all current statuses rather than relying on auto-merge without rules.

No workflow-level path filtering is used. PRs run on opening and every subsequent revision. Superseded runs are cancelled. Manual and weekly full validation remain available. Read-only PR jobs never receive publishing or deployment secrets.

## Presets

Import `@dcaldeira/repo-tooling/configs/prettier.mjs`. Extend `configs/tsconfig.json`, merge the plain Vitest/Playwright defaults with your own configuration and extend the ESLint flat config with your application's import boundaries. Install the peer tools you actually use; unused optional peers are not installed. Knip's JSON preset uses its `extends` support.

The extracted SCSS checker preserves Rookie's BEM, ordering, specificity and palette rules. The source path, nesting depth and specificity ceiling are configurable. Rookie's extra common-import, inline-style and media-query rules stay in its application adapter until a separate, verified generalization.

## Linux validation

Canonical browser screenshots and Lighthouse timings run on Ubuntu 24.04. Use WSL or a matching Linux container locally. Missing Linux/browser/backend tooling is an **unavailable** result, never a success. `--all` broadens selection; it does not waive platform requirements.

Hosted provisioning uses the selected plan: PostgreSQL 16/pgTAP only for database checks, pinned Deno/Lighthouse versions and pinned actionlint/gitleaks containers only when needed. Browser versions come from the consumer's Playwright lockfile. `--install` performs `npm ci --ignore-scripts`; install external prerequisites explicitly before running local CI.
