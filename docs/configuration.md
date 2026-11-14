# Configuration contract (schema version 1)

`repo-tooling.config.json` is plain JSON so its contents can be hashed and inspected without executing application code. `packages/tooling/config.schema.json` provides editor completion; the runner rejects unknown top-level/check keys, invalid groups, cycles and missing dependencies.

| Property         | Meaning                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`  | Exactly `1`                                                                                                           |
| `paths`          | Arrays of repository-relative globs by docs/styles/translations/app/database/functions/workflows/tooling/dependencies |
| `checks`         | Override default checks; `false` disables a capability the application does not use                                   |
| `environment`    | Environment variable names whose values invalidate cached results; values are never written to reports                |
| `styles`         | Source directory, maximum nesting depth and specificity tuple                                                         |
| `translations`   | Locale directory and authoritative language (without `.json`)                                                         |
| `budgets.bundle` | Distribution directory, initial/chunk gzip KB and optional `[package, label, KB]` vendor tuples                       |
| `release`        | Preparation argument array and exact list of version/changelog files to commit                                        |

Patterns support `*`, `**`, `?` and slash-separated paths, not brace expansion or negation. Paths override the patterns of the named group. Multiple specialized backend matches combine. Docs, styles and locale files take precedence over a general application-source match. Unknown paths broaden validation. Keep shared configurations out of narrowly classified source patterns.

Checks accept `command`, `devCommand`, `devAllCommand`, `devFiles`, `groups`, `profiles`, `dependsOn`, `cwd`, `tools` and `platforms`. Custom checks need command/groups/profiles. Prefer argument arrays to shell strings. Commands with appended changed filenames **must** be arrays: file names never pass through a shell. Use named npm scripts for application-specific compound commands. `tools` names are checked before execution. `platforms` is an allowlist (for example `["linux"]`). The working directory must stay inside the repository.

`--only=build,unit` includes dependencies automatically. `--skip=visual` records an intentional exclusion; if the check was required, the report remains incomplete and cannot authorize a push or release. Unknown IDs/options fail instead of silently running a different plan. `--bail` reports later checks as unavailable. `--plan` has no installation, execution or pass-recording side effects.

Default local CI is full; `--changed --base=<ref>` selects an entire branch diff plus staged, unstaged and untracked files. `--committed` selects committed changes only (hosted CI). `--head=<ref>` requires `--committed`. `--all` runs every configured check. Without a usable `origin/main`, changed mode requires an explicit base. Full mode works without a remote.

## Result and cache contract

Schema-versioned `summary.json` contains tooling version, profile, groups, required IDs, commit/base/tree, input fingerprint, timestamp, overall completeness and per-check `passed`, `failed`, `excluded` or `unavailable` status with duration/reason. `index.html` and terminal output describe the same results. JSON/HTML are written under the ignored `.repo-tooling/report` directory by default; use `--output=.repo-tooling/report` for CI artifacts.

Only complete push validation on a clean tree records a pass. It is keyed by HEAD, the current base revision, package version, Node/platform, exact configuration bytes, declared environment and the contents/modes of tracked and untracked files. A second snapshot after execution detects edits during checks. Gitignored build outputs and reports do not invalidate themselves. Lockfiles pin npm tools; external tool installations must remain fixed during validation. `--no-cache` forces another run.

`--watch --profile=dev --changed` polls and debounces changes, running one batch at a time. The 30-second development target is a measurement goal, not a guarantee; broad configuration changes deliberately run broader checks.

Additional ignored input files (such as Vite environment files) go in `inputs`; their contents enter the fingerprint without being included in reports. Installed npm lock metadata and declared external tool versions also invalidate cached validation.

Development defaults to local staged/unstaged/untracked edits against HEAD. Push and PR CI classify the full diff from the current base. They use the same detector and classification rules with those explicit revisions.

Pass state is stored in `.repo-tooling/state` per checkout. This also works in managed workspaces whose Git metadata is read-only. Keep the whole `.repo-tooling/` directory ignored; it is not a source or CI artifact input.

`devAllCommand` supplies the broad development fallback (also used for deleted unit inputs). The unit default is `vitest run`; coverage remains mandatory in push and CI profiles. Broad shared-configuration edits may take longer than the small-change development target.
