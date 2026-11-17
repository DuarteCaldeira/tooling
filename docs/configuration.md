# Configuration contract (schema version 1)

`tooling.config.json` is plain JSON so its contents can be hashed and inspected without executing application code. `packages/tooling/config.schema.json` provides editor completion; the runner rejects unknown top-level/check keys, invalid groups, cycles and missing dependencies.

| Property         | Meaning                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`  | Exactly `1`                                                                                                           |
| `paths`          | Arrays of repository-relative globs by docs/styles/translations/app/database/functions/workflows/tooling/dependencies |
| `checks`         | Override default checks; `false` disables a capability the application does not use                                   |
| `environment`    | Environment variable names whose values invalidate cached results; values are never written to reports                |
| `styles`         | Source directory, `standard`/`rookie` preset, rule switches, token paths, nesting depth and specificity tuple         |
| `execution`      | `concurrency` from 1 to 16; defaults to 2, or 1 with `--bail` unless explicitly configured                            |
| `translations`   | Locale directory and authoritative language (without `.json`)                                                         |
| `budgets.bundle` | Distribution directory, initial/chunk gzip KB and optional `[package, label, KB]` vendor tuples                       |
| `release`        | Preparation argument array and exact list of version/changelog files to commit                                        |

Patterns support `*`, `**`, `?` and slash-separated paths, not brace expansion or negation. Paths override the patterns of the named group. Multiple specialized backend matches combine. Docs, styles and locale files take precedence over a general application-source match. Unknown paths broaden validation. Keep shared configurations out of narrowly classified source patterns.

Checks accept `command`, `devCommand`, `devAllCommand`, `devFiles`, `groups`, `profiles`, `dependsOn`, `cwd`, `tools`, `platforms`, `resources`, `extends`, `workspaces` and `cache`. Custom checks need command/groups/profiles, or an `extends` naming a built-in preset. Prefer argument arrays to shell strings. Commands with appended changed filenames **must** be arrays: file names never pass through a shell. Use named npm scripts for application-specific compound commands. `tools` names are checked before execution. `platforms` is an allowlist (for example `["linux"]`). The working directory must stay inside the repository. Package binaries resolve from that directory through ancestor `node_modules` folders, so workspace-local installations take priority over hoisted tools.

Independent checks run concurrently up to `execution.concurrency` (or `--concurrency=N`). Checks with a shared `resources` name serialize; the built-ins lock `build` for type checking/building and `browser` for E2E/visual/Lighthouse work. Give custom checks matching resource names when they share ports, output directories or mutable inputs. `--concurrency=1` restores sequential execution. Bail stops scheduling new work after a failure; checks already running finish and appear in the report. Build success is passed to child processes through `TOOLING_BUILT`, without changing the runner's global environment.

The `standard` SCSS preset retains structural checks without enforcing Rookie's naming or colour conventions. `styles.preset: "rookie"` enables BEM, component-name matching and palette tokens. Override individual conventions with `styles.rules.bem`, `componentName` and `palette` booleans. Add repository-relative `styles.colourTokenPaths` globs for palette definition files. `styles.rules.layoutCss: true` reports flex layout (`display: flex`, `gap`, `flex-direction`, `flex-wrap`, `justify-content`, `align-items`) in `*.module.scss`, so layouts use the shared layout primitive (`Stack`); list shared layout components in `styles.layoutPaths` globs to exempt them, or mark a single exception with `// lint-scss-disable-next-line layout-css`. Grid stays allowed. The Rookie example explicitly selects its preset.

Browser defaults separate functional tests (`--grep-invert @visual`) from visual tests (`--grep @visual`). Custom npm adapters must make the same separation. Merge the Playwright preset to retain separate HTML, JSON and test-result directories.

Bundle checks recognize relative URLs and deployment prefixes in `dist/index.html`, follow static ESM imports/re-exports transitively, deduplicate shared chunks and exclude dynamic imports from the initial budget. Missing local JS entries and malformed source maps fail validation. External URLs are excluded from the local bundle budget.

`--only=build,unit` includes dependencies automatically. `--skip=visual` records an intentional exclusion; if the check was required, the report remains incomplete and cannot authorize a push or release. Unknown IDs/options fail instead of silently running a different plan. `--bail` reports later checks as unavailable. `--plan` has no installation, execution or pass-recording side effects.

Default local CI is full; `--changed --base=<ref>` selects an entire branch diff plus staged, unstaged and untracked files. `--committed` selects committed changes only (hosted CI). `--head=<ref>` requires `--committed`. `--all` runs every configured check. Without a usable `origin/main`, changed mode requires an explicit base. Full mode works without a remote.

## Result and cache contract

Schema-versioned `summary.json` contains tooling version, profile, groups, required IDs, commit/base/tree, input fingerprint, timestamp, overall completeness and per-check `passed`, `failed`, `excluded` or `unavailable` status with duration/reason. `index.html` and terminal output describe the same results. JSON/HTML are written under the ignored `.tooling/report` directory by default; use `--output=.tooling/report` for CI artifacts.

Only complete push validation on a clean tree records a pass. It is keyed by HEAD, the current base revision, package version, Node/platform, exact configuration bytes, declared environment and the contents/modes of tracked and untracked files. A second snapshot after execution detects edits during checks. Gitignored build outputs and reports do not invalidate themselves. Lockfiles pin npm tools; external tool installations must remain fixed during validation. `--no-cache` forces another run.

`--watch --profile=dev --changed` watches filesystem events and debounces changes, running one batch at a time. The 30-second development target is a measurement goal, not a guarantee; broad configuration changes deliberately run broader checks.

Additional ignored input files (such as Vite environment files) go in `inputs`; their contents enter the fingerprint without being included in reports. Installed npm lock metadata and declared external tool versions also invalidate cached validation.

Development defaults to local staged/unstaged/untracked edits against HEAD. Push and PR CI classify the full diff from the current base. They use the same detector and classification rules with those explicit revisions.

Pass state is stored in `.tooling/state` per checkout. This also works in managed workspaces whose Git metadata is read-only. Keep the whole `.tooling/` directory ignored; it is not a source or CI artifact input.

`devAllCommand` supplies the broad development fallback (also used for deleted unit inputs). The unit default is `vitest run`; coverage remains mandatory in push and CI profiles. Broad shared-configuration edits may take longer than the small-change development target.

## Workspace selection

`workspaces` maps names to repository-relative `paths` globs and optional `dependsOn` workspace names. A check's `workspaces` list scopes it to those workspaces and their transitive dependencies. Checks without a scope remain global. Names, missing dependencies and cycles are checked before execution. Workspace-owned source paths default to the `app` group; docs, styles and translations keep their specialized selection rules. Lockfiles, shared configuration and unknown files still broaden validation across all workspaces.

Use `extends` to create multiple instances of a built-in check:

```json
{
  "workspaces": {
    "web": { "paths": ["apps/web/**"], "dependsOn": ["ui"] },
    "admin": { "paths": ["apps/admin/**"], "dependsOn": ["ui"] },
    "ui": { "paths": ["packages/ui/**"] }
  },
  "checks": {
    "lint": false,
    "web-lint": { "extends": "lint", "cwd": "apps/web", "workspaces": ["web"] },
    "admin-lint": { "extends": "lint", "cwd": "apps/admin", "workspaces": ["admin"] }
  }
}
```

A web edit selects web checks; a UI edit selects both applications. Declare all shared-source dependencies, including non-npm packages such as shared generated types. `dependsOn` on a check still names **check IDs**: a `web-e2e` extending `e2e` should set `dependsOn: ["web-build"]`. Resource names are global; use per-workspace build locks only when builds have independent outputs. The full example is in `examples/multi-workspace/tooling.config.json`. Plans and JSON reports list `affectedWorkspaces`.

## Incremental validation

Built-in formatting, ESLint, SCSS, translations, dead-code and workflow diagnostics can reuse successful results from `.tooling/state/checks`. The key includes the actual command/profile/development file arguments, configuration, Node/platform, declared environment and ignored inputs, installed lock metadata, relevant tool identities and input contents/modes. Root checks conservatively use every repository input. Scoped checks use their workspace dependency closure plus all global control/unknown files. Adding or deleting an input invalidates its result.

Overridden commands and custom checks do not inherit result caching automatically. Set `cache: true` only for deterministic checks that produce no required artifacts, or `cache: { "inputs": ["src/**", "scripts/check.mjs"] }` to declare the complete repository-relative input set. Shared configuration, dependency manifests/lockfiles and unknown paths always invalidate even narrowed sets. Use `cache: false` per check or `execution.checkCache: false` globally to disable result reuse. TypeScript result caching requires an explicit declaration because some type-check commands also emit files.

Security, builds, bundle analysis, coverage/unit, database, browser and Lighthouse checks always run; dependent checks are not result-cached. Successful independent diagnostics can be reused after another check fails, but only if the before/after repository snapshots match. Changes made during validation prevent all new cache records. Excluded, failed and unavailable results never become cached successes. A whole push pass is reused only when every selected check is eligible for deterministic result caching. This keeps audits fresh even on an unchanged commit.

`--all` bypasses per-check success records for full validation. `--no-cache` bypasses both per-check and whole-pass records, disables runner-managed ESLint caching and adds `--force` to built-in `tsc --build` commands. Custom npm scripts control their own internal caches.

ESLint's built-in commands use `--cache --cache-strategy content`; each check writes a separate file under `.tooling/cache/eslint`. CI and release workflows restore those tool caches, keyed by OS, the Node version file and lockfile, with a per-commit save key. These are tool-managed caches that revalidate inputs; success records in `.tooling/state` are never restored from Actions caches.

TypeScript already maintains incremental metadata through `tsc --build`. For **noEmit type-check projects**, opt into CI persistence by listing their actual ignored metadata paths in `execution.typeScriptBuildInfo`, for example `["frontend/node_modules/.tmp/tsconfig.app.tsbuildinfo"]`. Keep metadata-only restoration off for emitting builds unless their matching emitted outputs are also managed: metadata alone must not stand in for build artifacts. Paths must stay inside the repository and end in `.tsbuildinfo`.

Snapshots still read repository contents before and after validation to detect concurrent edits. Their file digests are reused for all check cache keys. npm tool identities come from the resolved package manifest and CLI entry contents, while Node uses its running version; external tools still have their versions probed. Glob expressions are compiled once in a bounded in-memory cache.

Empty plans skip installation, source fingerprinting, report generation and pass recording. CI still completes its required result job. Explicit exclusions keep a plan active and incomplete rather than taking the empty-plan shortcut.

Both ordinary CI and release validation use the same browser provisioning helper. Only selected E2E, visual or Lighthouse checks need browsers. Playwright installation resolves from each check's workspace and is deduplicated by package installation. Browser cache keys use locked Playwright versions, so unrelated dependency bumps do not discard the browser cache. Lighthouse can use `CHROME_PATH` or native Chrome without requiring Playwright; if neither is available, a locked Playwright installation supplies Chromium. Missing browser prerequisites fail validation.

## Additional project checks

Architecture, rendered accessibility, dependency consistency, generators, PR summaries and performance history are documented in [project features](project-features.md). They use optional top-level `architecture`, `a11y`, `dependencyConsistency`, `generators`, `reporting` and `history` settings validated by the package schema. The three new checks are activated by their configuration section or explicit `checks` entry and can be disabled with `false` like other capabilities. Existing consumer gates and documentation/style-only selection remain unchanged until a capability is enabled.

`duplication` (opt-in through a top-level `duplication` section or `checks.duplication`) runs [jscpd](https://github.com/kucherenko/jscpd) over `duplication.paths` (default `["src"]`) with `minTokens` (default 70) and extra `ignore` globs; tests, mocks, generated and `dist` files are ignored. Install `jscpd` as a devDependency. In every profile only clones that involve a changed file fail (dev passes the files, `push`/`ci` get the branch's changed files through `TOOLING_CHANGED_FILES`), so existing duplication never blocks unrelated work. An `--all` run has no change to judge: it lists existing clones without failing. Set `duplication.scope: "all"` to fail on every clone once a repository has none.
