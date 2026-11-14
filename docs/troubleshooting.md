# Troubleshooting

| Symptom                                         | Action                                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Changed mode has no base                        | Fetch `origin/main` or provide `--base=<commit>`; use `--all` for a new repository                                               |
| Missing Deno/Postgres/pgTAP/actionlint/gitleaks | Install the reported prerequisite; required unavailable checks block the pass                                                    |
| Browser/Lighthouse unavailable on Windows       | Run from WSL/Linux with the same lockfile and browser versions as CI                                                             |
| A skipped check leaves a red gate               | Expected: `--skip` is an explicit incomplete validation, not a full CI replacement                                               |
| A pass no longer matches                        | Commit all files, fetch the current base and run `check:push`; do not bypass the hook                                            |
| Release reruns checks                           | Verify the signing key, bot identity, workflow/run, base/head/tree, config digest and tooling version; regenerate after any edit |
| Dependabot stays open                           | Inspect current head's CI, check runs and statuses; failed/pending checks or a stale SHA prevent merging                         |
| CI minutes exhausted                            | `ci:local --all --install`; install external prerequisites and use Linux, then inspect the JSON/HTML reports                     |
| Visual noise across platforms                   | Regenerate baselines only on canonical Linux, with the lockfile's Playwright/browser version                                     |

Baseline updates are explicit (`playwright test --update-snapshots`), reviewed separately and never run by ordinary CI. Playwright's HTML report must be enabled to retain expected/actual/diff attachments. Do not copy only `index.html`; `visual-report.mjs` copies the report and all its assets.
