# App release dashboard

The GitHub Pages dashboard shows the latest published release of each configured app, the shared tooling used at that release, and its publication date (UTC). It includes prereleases. It does not treat a package version on main as a release, or guess a tooling version from a dependency range.

## Apps

Edit `dashboard/apps.json` to add or remove apps. The initial list includes Rookie, Billy, Dra. Gabriela Videira, Saudinha, SwipeIt and Despesas. Only explicitly listed repositories are published. Optional `packagePath`, `lockPath` and `workflowPath` support monorepos and custom CI locations; paths are relative to the repository root.

Collection resolves each release tag to its commit, then reads the manifest and npm lockfile at that commit. Tooling comes from `@dcaldeira/tooling` (or its previous package name), preferring the nearest workspace installation in `package-lock.json`. Exact manifest versions work without a lockfile. Unresolved ranges, non-npm lockfiles and moving workflow refs are labelled unresolved. Alternatively, a SHA-pinned reusable workflow in `.github/workflows/ci.yml` resolves to `packages/tooling/package.json` at that exact tooling revision. The revision appears below the version, since multiple commits can share a package version. Configure `workflowPath` if the app uses another workflow file.

Apps without releases show “No releases yet”. Released apps without the package or a shared workflow show “Not adopted”. Access errors show “Unavailable”; tooling-only errors preserve the release and show a warning. If every repository is inaccessible, collection fails and leaves the previous deployment intact. A last-checked timestamp and overdue indicator make stale deployments visible. No repository code is executed during collection, and API responses, credentials and release bodies are excluded from the deployed data.

## First deployment

1. Merge this branch into `main`.
2. In `DuarteCaldeira/tooling` → Settings → Pages, choose **GitHub Actions** as the source. GitHub Pages availability for a private repository depends on the account plan. Keep the repository private; do not change visibility just to enable hosting.
3. Create an expiring fine-grained PAT (or GitHub App installation token) with **Contents: read** for the listed app repositories and tooling. Save it as the **APPS_READ_TOKEN** Actions secret in tooling. The ordinary tooling `GITHUB_TOKEN` cannot read other private repositories. Tokens with inaccessible repositories produce visible warnings.
4. Run **App dashboard** from Actions. The deploy job exposes the Pages URL, normally `https://duartecaldeira.github.io/tooling/`.

GitHub Pages is normally publicly accessible, even when its source repository is private. The selected app names, repository names, versions and dates are published. Use a suitable enterprise Pages access policy if this metadata needs restricted access. No token is sent to the browser.

## Update immediately after an app release

Create a second fine-grained PAT with **Contents: write only on DuarteCaldeira/tooling** (the permission required for `repository_dispatch`). Store it as **DASHBOARD_DISPATCH_TOKEN** in each app. For a GitHub App token, give the app the equivalent repository permission. If tooling is private, also allow its reusable workflows to be accessed by your app repositories under Settings → Actions → General → Access.

Copy `dashboard/templates/notify-dashboard.yml` into each app's `.github/workflows/`. Replace `REPLACE_WITH_DASHBOARD_COMMIT_SHA` with the merged commit SHA. On published, edited or deleted releases it calls the reusable notification workflow, which dispatches `app-released` to tooling. The dashboard rebuilds the configured allowlist from GitHub; it never trusts versions or repository names supplied in dispatch payloads.

**Releases created with an app's GITHUB_TOKEN do not trigger a separate release-event workflow.** In that case, call the reusable workflow explicitly as a job after the publishing job, including workflows using the shared release finalizer:

```yaml
jobs:
  publish:
    # Your existing release job (must finish publishing before notification).
    # ...
  dashboard:
    needs: publish
    permissions: {}
    uses: DuarteCaldeira/tooling/.github/workflows/notify-app-release.yml@REPLACE_WITH_DASHBOARD_COMMIT_SHA
    secrets:
      DASHBOARD_DISPATCH_TOKEN: ${{ secrets.DASHBOARD_DISPATCH_TOKEN }}
```

Add this to the workflow which actually publishes the release, not the workflow which only opens a release PR. For a local finalizer, a release made using a PAT triggers the event template; the scheduled fallback also picks it up.

A scheduled rebuild runs every 15 minutes to reconcile missed notifications, edited releases and deletions. GitHub can delay scheduled jobs; the schedule is a fallback, not an immediate-update guarantee. Notifications can also be sent with the app template's manual dispatch. Tokens need renewal when they expire.

## Local checks

```sh
node --test tests/dashboard.test.mjs
# With APPS_READ_TOKEN set in your environment:
node dashboard/collect.mjs
```

Serve `.tooling/dashboard-site` with a static server to preview. The dashboard has no runtime API credentials, external fonts, third-party JavaScript or build dependencies. Its search works locally against the deployed snapshot. Data is fetched once when opening the page; reload to see a newer deployment.
