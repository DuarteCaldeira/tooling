# App release dashboard

The Vercel release hub replaces manual Product Owner update messages with a shareable release history for each app. Product changes come first; the application overview retains the latest version, shared tooling version and release date (UTC). It includes prereleases. It does not treat a package version on main as a release, or guess a tooling version from a dependency range.

## Product release notes

Choose an app from the emoji picker (or the selector on mobile) to browse its releases, search changes or versions, and filter to product notes. Saudinha opens by default; the app selector updates the shareable URL (`?app=DuarteCaldeira%2Fsaudinha-pnn#release-notes`). A compact summary shows the selected app's latest version, last release and tooling version. All six apps remain available in the overview, and SwipeIt is excluded from collection and publication. Releases keep the 🚀 emoji heading style.

`dashboard/release-notes.json` contains the supplied Portuguese summaries for Saudinha versions 1.17.1 through 1.21.1, keyed by repository and version without the `v` prefix. These summaries are shown only when a matching published GitHub release exists. Dates always come from the published release. Product notes preserve their original language.

For automatic product notes on new releases, publish a top-level `Novidades` (Portuguese) or `Product updates` (English) section with plain-language bullet points in the GitHub release body:

```markdown
## Novidades

- Consultas: novos lembretes antes da consulta
- Pesquisa: encontra exames pelo local e pela data

## Technical changes

- Internal implementation details can remain here.
```

Collection reads those bullets at each refresh. An explicit summary in `release-notes.json` takes precedence. Releases without an edited summary or product section show an honest “Product summary not available” message and expandable original GitHub notes; the site does not invent or automatically translate summaries. Release bodies are rendered as inert text, including any Markdown or HTML in the original notes. The first ten releases appear initially; “Show older releases” loads more from the collected history.

## Apps

Edit `dashboard/apps.json` to add or remove apps. The list includes Rookie, Billy, Dra. Gabriela Videira, Saudinha, Despesas and Design system (`DuarteCaldeira/design-system`). Each app can have an `emoji`. Only explicitly listed repositories are published; include each private repository in the read token's access list. Optional `packagePath`, `lockPath` and `workflowPath` support monorepos and custom CI locations; paths are relative to the repository root.

Collection resolves each release tag to its commit, then reads the manifest and npm lockfile at that commit. Tooling comes from `@dcaldeira/tooling` (or its previous package name), preferring the nearest workspace installation in `package-lock.json`. Exact manifest versions work without a lockfile. Unresolved ranges, non-npm lockfiles and moving workflow refs are labelled unresolved. Alternatively, a SHA-pinned reusable workflow in `.github/workflows/ci.yml` resolves to `packages/tooling/package.json` at that exact tooling revision. The revision appears below the version, since multiple commits can share a package version. Configure `workflowPath` if the app uses another workflow file.

Apps without releases show "No releases yet". Released apps without the package or a shared workflow show "Not adopted". Access errors show "Unavailable"; tooling-only errors preserve the release and show a warning. If every repository is inaccessible, collection fails and leaves the previous deployment intact. A last-checked timestamp and overdue indicator make stale deployments visible. No repository code is executed during collection. Only selected app metadata, published release notes and their edited summaries are deployed; credentials and source manifests are excluded.

## First deployment

1. Merge this branch into `main`.
2. Import `DuarteCaldeira/tooling` into Vercel as a new project. Set **Root Directory** to `dashboard`, **Framework Preset** to **Other**, **Node.js** to **22.x**, and **Production Branch** to `main`. `dashboard/vercel.json` supplies the build command (`node build.mjs`), skips dependency installation, and serves only `dist`. Leave the repository private.
3. Create an expiring fine-grained PAT with **Contents: read** for the listed app repositories and tooling. Save it as the **APPS_READ_TOKEN** environment variable in Vercel's **Production** environment. The ordinary tooling `GITHUB_TOKEN` cannot read other private repositories. A GitHub App token also works if your setup refreshes it before builds. Do not expose the token through a public/client environment variable.
4. Deploy. The build collects release data on Vercel; a missing token or total repository-access failure fails the build and preserves the previous production deployment. Vercel provides the live project URL. Preview deployments also need a suitable read token in the Preview environment; otherwise they deliberately fail instead of publishing misleading data.
5. In Vercel project **Settings → Git → Deploy Hooks**, create an `app-releases` hook targeting **main**. Save its complete URL as the **VERCEL_DEPLOY_HOOK** Actions secret in `DuarteCaldeira/tooling`. Treat this URL as a credential and never commit it.
6. Run **Refresh app dashboard** from GitHub Actions. It requests a Vercel build; inspect the Vercel deployment to confirm it finished successfully. Git pushes deploy through Vercel's Git integration, while release notifications and scheduled refreshes use the hook. No Vercel API token or GitHub Pages setup is needed.

The selected app names, repository names, versions and dates are present in the static site. Configure Vercel Deployment Protection if this metadata needs restricted access. No read token or deploy-hook URL is sent to the browser. This workflow replaces the previous Pages deployment; remove any old Pages publication configuration if it was enabled.

See Vercel's [project configuration](https://vercel.com/docs/project-configuration/vercel-json) and [deploy-hook documentation](https://vercel.com/docs/deploy-hooks).

## Update immediately after an app release

Create a second fine-grained PAT with **Contents: write only on DuarteCaldeira/tooling** (the permission required for `repository_dispatch`). Store it as **DASHBOARD_DISPATCH_TOKEN** in each app. For a GitHub App token, give the app the equivalent repository permission. If tooling is private, also allow its reusable workflows to be accessed by your app repositories under Settings → Actions → General → Access.

Copy `dashboard/templates/notify-dashboard.yml` into each app's `.github/workflows/`. Replace `REPLACE_WITH_DASHBOARD_COMMIT_SHA` with the merged commit SHA. On published, edited or deleted releases it calls the reusable notification workflow, which dispatches `app-released` to tooling. Tooling requests a Vercel deployment; the Vercel build reads the configured allowlist from GitHub. No versions or repository names supplied in dispatch payloads are trusted. Existing app notifications continue working after the hosting migration.

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

A scheduled refresh requests a Vercel build every 15 minutes to reconcile missed notifications, edited releases and deletions. GitHub can delay scheduled jobs; the schedule is a fallback, not an immediate-update guarantee. Notifications can also be sent with the app template's manual dispatch. Build time is needed before fresh data becomes visible. The Actions job confirms that Vercel accepted the request, not that deployment finished. Tokens need renewal when they expire.

## Local checks

```sh
node --test tests/dashboard.test.mjs
# With APPS_READ_TOKEN set in your environment:
node dashboard/collect.mjs
# Build exactly the static output used by Vercel:
node dashboard/build.mjs
```

Serve `.tooling/dashboard-site` (collector CLI) or `dashboard/dist` (Vercel build) with a static server to preview. The dashboard has no runtime API credentials, external fonts, third-party JavaScript or build dependencies. Its search works locally against the deployed snapshot. Data is fetched once when opening the page; reload to see a newer deployment.
