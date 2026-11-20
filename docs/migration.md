# Rookie pilot and the next application

The package, CLI and repository are now `@dcaldeira/tooling`, `tooling` and `DuarteCaldeira/tooling`. Rename the consumer configuration to `tooling.config.json`, use `.tooling/` for ignored state/reports and update `REPO_TOOLING_*` environment variables/repository variables to `TOOLING_*`. Replace the old package dependency, schema/config imports, tarball and workflow references together, then regenerate the npm lockfile. Existing pass records are intentionally not reused.

1. Preserve existing UI/backend work and run the shared planner against representative file sets before replacing commands. `npm test` here checks docs-only, SCSS-only, translations, mixed, dependency and unknown-file cases. `examples/rookie/compare.mjs` prints old scope flags alongside new check IDs for the real branch without executing checks.
2. Install the exact package (the pilot uses `tools/dcaldeira-tooling-0.1.0.tgz` while public publication is pending). Introduce `check:dev`; replace the old local runner and pass guard with thin package calls. Keep application-specific migration, shared-code, CSP, XP and deployment adapters in Rookie.
3. Replace duplicated SCSS, translation parity, audit and bundle machinery in stages. Keep the extra Rookie translation-source/typographic rules in its current adapter; the shared parity check is separate. Preset adoption should preserve the existing effective config; do not replace import boundaries or app-specific thresholds with generic defaults.
4. Switch the caller CI and release workflows together after pushing this repository's pinned SHA. Keep no second copy of the selection rules. Disable the old release-prefix publisher and admin-release shortcuts. The signed finalizer owns tagging/publishing; the application owns deployment.
5. Configure the signing key/public variable, GitHub Actions PR-creation permission and available branch protection. Test one docs PR, one SCSS PR, a mixed PR, a failed prerequisite, and a release candidate followed by an edit. Canonical browser/Lighthouse validation must run on Linux.
6. Once npm publication succeeds, change the devDependency to exact `0.1.0`, regenerate the lockfile, remove the pilot tarball and rerun the gate. Workflow commit pins remain independent of the npm version.

Rookie budgets, locale names, coverage floors, exercise seed generation, Supabase setup and environment variables belong to Rookie. Do not extract its workout/domain logic. Internal tooling work has no What's New entry.

## First publication

From this directory, once authenticated and online:

```sh
gh repo create DuarteCaldeira/tooling --public --source=. --remote=origin --push
gh workflow run package-release.yml --ref main
```

Pushing a `v*` tag no longer publishes: the **Release tooling package** workflow creates the tag, the GitHub release and the npm publication together. It requires npm trusted publishing or an npm automation token configured for this package. Review `npm pack --dry-run -w packages/tooling` before publication. Neither GitHub repository creation nor npm publication is completed by a local Git commit.
