# Script checks

The checks can be invoked by the tooling runner or directly with Node. Direct invocations
use `TOOLING_ROOT` when set, otherwise the current directory.

- `checks/audit.mjs` runs production and full npm audits. Production high/critical
  advisories always fail. Development advisories require an unexpired exception in
  `audit-allowlist.json`, or the file selected by `TOOLING_AUDIT_ALLOWLIST`.
  The default file is optional when there are no exceptions; an explicitly selected
  file must exist. Entries require a unique advisory ID, a reason, and a valid
  `YYYY-MM-DD` expiry date. npm API, authentication, malformed report and subprocess
  errors fail the check.
- `checks/scan-secrets.mjs` scans tracked and unignored untracked text files, including
  lockfiles. It decodes JWT payloads to detect Supabase service-role credentials.
  Symlinks, known binary assets and deleted files are skipped. Diagnostics contain
  file paths and credential types, never credential values.
- `checks/lint-scss.mjs --fix` applies property ordering fixes, then checks the result.
  Remaining violations produce a failing exit code. Directory discovery avoids
  symlinks, preventing recursive directory loops.

Architecture and workspace dependency analysis keep module-resolution caches local
to the current analysis, with a separate cache for each workspace's compiler options.
A new validation run starts fresh so source changes cannot reuse stale resolutions.
Check planning expands shared prerequisites once and still rejects dependency cycles.

Run `npm test` for script regressions. GitHub Actions runs these on Linux and Windows,
and runs the rendered accessibility and dashboard browser suites on Linux.
