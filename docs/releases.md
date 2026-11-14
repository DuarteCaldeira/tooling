# Release validation and trust

The reusable release workflow runs only from a `workflow_dispatch` on `main`. Its read-only job checks out the exact source revision, runs the application's preparation adapter, commits only the declared files, then runs **full CI on that prepared commit**. It exports the commit in a Git bundle and a full runner report. Failed or incomplete validation never reaches PR creation.

A separate write-enabled job imports the bundle without checking out or executing candidate code. It compares the candidate outputs and tree, rejects an advanced main branch, signs an Ed25519 envelope and creates the PR as GitHub Actions. The signing secret exists only in this job. The envelope is placed in a PR-body marker; modifying that marker cannot forge its signature.

The envelope binds repository, generator workflow/run, source SHA, prepared head/tree, configuration digest and tooling version. Verification fetches current PR/head/base/configuration through the API; it checks bot login and numeric identity, signature, workflow-run provenance and every bound value. A prefix or label grants no trust. The generating workflow may still be completing its final dispatch when verification begins; the signature is issued only after full validation, and a failed/cancelled generating run is rejected.

The default GitHub token's PR creation does not trigger PR workflows. The generator explicitly dispatches `ci.yml` with the PR number. That routing run performs signature verification and satisfies the stable result without running the validation suite again. Direct later edits or base movement invalidate the envelope and force normal validation. To restore release trust, generate a fresh candidate.

## Keys

Generate an Ed25519 key pair outside the repository. Store the private PEM as the `REPO_TOOLING_RELEASE_SIGNING_KEY` Actions secret and the public PEM as the `REPO_TOOLING_RELEASE_PUBLIC_KEY` repository variable. The public key is not secret. No key is generated or committed by this project. Rotate keys by replacing both values; old envelopes will cease to verify.

## Merge, tag and publish

Run `node node_modules/@dcaldeira/repo-tooling/release/finalize.mjs <pr-number>`. It verifies current signed evidence, uses a squash merge with `--match-head-commit` and no admin bypass, requires the resulting tree to equal the validated tree, creates the version tag and publishes the GitHub release. Deployment remains application-owned. Rules should require current validation and up-to-date base branches where available.

There is deliberately no “merge whichever release branch exists” fallback. Missing keys, unavailable API access, stale evidence or a different merged tree fail closed. Recovery after an interrupted tag/publication needs an explicit inspection of the existing tag/release; the finalizer never silently overwrites them.

Hosted routing still consumes a few Actions jobs. No claim of literally zero jobs is made. Avoid enabling the consumer's old branch-prefix publication workflow alongside this flow.
