# App release dashboard

The Vercel release hub replaces manual Product Owner update messages with a shareable release history for each app. Product changes come first; the application overview retains the latest version, shared tooling version and release date and time in Europe/Lisbon (including daylight saving time). It includes prereleases. It does not treat a package version on main as a release, or guess a tooling version from a dependency range.

## Design foundation and topics

The dashboard is a React app (`dashboard/src`, built with Vite) that uses the components from `@dcaldeira/design-system` (Accordion, Drawer, Input, Select, Textarea, Button, Tag, Badge, Card and Progress) through `ThemeProvider` and `@dcaldeira/design-system/style.css`. `dashboard/design-system.css` is a small checked-in token bridge (spacing, radius, motion and palette variables) used by the page layout in `dashboard/src/styles.css`.

Topic tags are inferred deterministically from each item’s existing text, with app areas and cross-cutting categories such as Acessibilidade, Segurança, Dados, UX and Performance. Clicking a tag selects its topic filter. Topic labels are searchable, filters combine with review states, and item IDs and existing conversations remain unchanged. These are navigation hints, not additional release claims. Animations use design-system motion tokens and are disabled when reduced motion is requested.

## Product release notes

“Reportar bug” opens a separate form for the selected app and release, with “Problema” selected by default and the version shown at the top. Submitting creates a shared item under “Problemas reportados” in that release, with its own conversation and resolution state. These reports are stored separately from published release notes and do not affect product validation totals. Retrying the same submission does not create a duplicate item.

The report uses Portuguese UI and full dates such as `15 de novembro, 2026 23:47`. Click a change card to open its conversation in a side panel. Only product items require validation; technical items remain available for reading and discussion. Every release is collapsible and defaults to collapsed once all its product items are validated. Manual expansion choices survive review refreshes during the session. Expand/recollect all controls are available. Combine independent content, validation and conversation filters, including validated items or resolved conversations; search ignores accents and supports multiple words. The current filters remain in the page URL, with a one-click clear action; there is no separate share button. Resolve or reopen a conversation in its panel; a later comment reopens it. Validation counters cover product items across all releases for the selected app; conversation counts also include technical and release-level threads. Filters affect individual visible items.

Validation and conversation status are shared through immutable private Blob events, scoped to the app, release and stable item ID. Their boolean values are encoded in event metadata filenames so summary reads do not download each event body. No personal browser state is used as the shared validation source. Comments use only their selected display name. Message cards separate the author and timestamp from the body and action footer. Question badges use a blue question mark, while issue badges use a red exclamation mark; their labels remain explicit. QAren messages appear on the right and other messages on the left. No browser participant ID or display-name preference is stored in localStorage, and comments have no Tu badge.

Choose an app from the emoji picker (or the selector on mobile) to browse its releases, search changes or versions, and filter to product notes. Saudinha opens by default; the app selector updates the shareable URL (`?app=DuarteCaldeira%2Fsaudinha-pnn#release-notes`). A compact summary shows the selected app's latest version, last release and tooling version. All six apps remain available in the overview, and SwipeIt is excluded from collection and publication. Releases keep the 🚀 emoji heading style.

`dashboard/release-notes.json` contains reviewed Portuguese summaries for all 32 published Saudinha versions and 28 published Rookie versions, including 1.27.2. Saudinha's source is its versioned `CHANGELOG.md`; Rookie's versioned in-app changelog and Portuguese translations were checked as well as GitHub release notes, because some GitHub releases contain cumulative older changes. Design system 1.0.0 has no published changelog detail and is labelled accordingly. Summaries are shown only when a matching published release exists. Dates come from GitHub and historical behaviours remain tied to their own version.

Technical maintenance appears in **Detalhes técnicos**, collapsed by default, only when technical items exist. The original-changelog expander is omitted. Routine dependency, test, build and release-script updates stay out of the main product summary. No AI provider is called at build time; new app-authored `Novidades` sections are imported automatically, and reviewed summaries can be edited in the file.

For automatic product notes on new releases, publish a top-level `Novidades` (Portuguese) or `Product updates` (English) section with plain-language bullet points in the GitHub release body:

```markdown
## Novidades

- Consultas: novos lembretes antes da consulta
- Pesquisa: encontra exames pelo local e pela data

## Technical changes

- Internal implementation details can remain here.
```

Collection reads those bullets at each refresh. An explicit summary in `release-notes.json` takes precedence. Releases without an edited summary or product section show an honest “Product summary not available” message and expandable original GitHub notes; the site does not invent or automatically translate summaries. Visible notes and comments are rendered as inert text; original release bodies remain available through GitHub. The first ten releases appear initially; “Show older releases” loads more from the collected history.

## Apps

Edit `dashboard/apps.json` to add or remove apps. The list includes Rookie, Billy, Dra. Gabriela Videira, Saudinha, Despesas and Design system (`DuarteCaldeira/design-system`). Each app can have an `emoji`. Only explicitly listed repositories are published; include each private repository in the read token's access list. Optional `packagePath`, `lockPath` and `workflowPath` support monorepos and custom CI locations; paths are relative to the repository root.

## Shared discussions

Each product or technical item has a **Discuss** button. **Release discussion / new finding** opens the release-level conversation for issues outside the listed changes. Participants can choose Comment, Question or Issue, write a display name, reply, and share a direct thread link. Open threads refresh every 15 seconds. Drafts are retained while switching or reopening threads in the current tab, and network retries reuse a request ID to avoid duplicate posts.

Comments are shared server-side, rather than saved only in a browser. The Vercel project uses the private `tooling-release-discussions` Blob store in `fra1`; its connection supplies `BLOB_READ_WRITE_TOKEN`. Each comment is an immutable object, preventing simultaneous posts from overwriting one another. The Node function validates every app, version and item against a manifest generated from the current runtime release snapshot. It limits comment size and posting rate, rejects cross-origin writes, paginates history, and never renders submitted HTML. Old rate-limit records are removed opportunistically when that participant posts again. Display names are participant-provided, not verified account identities. Keep Vercel Deployment Protection enabled and grant reviewers access to the dashboard.

Product notes have persisted `itemIds`. When changing wording, keep the matching ID; when adding/removing/reordering notes, update the parallel ID array accordingly. Moving an item to a different ID creates a different conversation. Fallback IDs for app-authored notes and technical entries are based on their text. Published source text should remain stable; retain an explicit editorial ID if a wording correction needs to preserve a thread.

The private store is already provisioned and connected to this project. For a different project, create/connect a private Vercel Blob store first. The server SDK is pinned with a dashboard-specific lockfile; a same-major Zod override fixes the SDK's transitive audit finding. The runtime also stores a shared release snapshot in this private store, separately from immutable discussion events. Neither storage credentials nor the server manifest are included in the static site.

Collection resolves each release tag to its commit, then reads the manifest and npm lockfile at that commit. Tooling comes from `@dcaldeira/tooling` (or its previous package name), preferring the nearest workspace installation in `package-lock.json`. Exact manifest versions work without a lockfile. Unresolved ranges, non-npm lockfiles and moving workflow refs are labelled unresolved. Alternatively, a SHA-pinned reusable workflow in `.github/workflows/ci.yml` resolves to `packages/tooling/package.json` at that exact tooling revision. The revision appears below the version, since multiple commits can share a package version. Configure `workflowPath` if the app uses another workflow file.

Apps without releases show "No releases yet". Released apps without the package or a shared workflow show "Not adopted". Access errors show "Unavailable"; tooling-only errors preserve the release and show a warning. If every repository is inaccessible, the runtime retains its last successful snapshot and retries after a minute. During partial outages, previously collected releases for inaccessible apps remain available. A last-checked timestamp and overdue indicator make stale data visible. No repository code is executed during collection. Only selected app metadata, published release notes and their edited summaries are returned by the API; credentials and source manifests are excluded.

## Runtime updates

The browser reads `/api/releases` on opening the dashboard, every 30 seconds while visible, and when returning to the tab. The server collects GitHub releases with a 60-second cache shared through private Vercel Blob storage. Concurrent requests within a function instance share one refresh. Expect updates in roughly 60–90 seconds plus collection time under normal conditions; this is polling, not an instant push guarantee. Hidden tabs pause polling. The current app, filters, expanded releases and conversation drafts survive background updates. Failed refreshes retain visible data and display an error; server-side collection failures retain the previous timestamp, with an overdue indicator after two minutes.

Discussion validation uses the same runtime source, so newly discovered releases accept comments and validation without rebuilding. Each refresh uses a fresh GitHub client, preventing its request cache from hiding new releases. No repository code is executed.

New releases, edited release bodies, deletions and released tooling versions need no deployment. Changing the app allowlist, reviewed summaries in `release-notes.json`, dashboard code or the design-system dependency still requires a deployment. Versions continue to represent published releases and the tooling dependency at each release commit, not unpublished changes on main.

## API latency

Functions run in Frankfurt (`fra1`), next to the private Blob store. This uses a single region. See the [function-region configuration](https://vercel.com/docs/functions/configuring-functions/region).

Discussion requests validate known threads against the cached release manifest rather than waiting for a full GitHub collection. Shared snapshots are checked at most once per minute per function instance. A previously unknown release or item takes the normal refresh path before it can be accepted; no unlisted target bypasses manifest validation. The release endpoint still refreshes live GitHub data, with its existing outage fallback and retry backoff.

Only the selected app loads and polls its review summary. Concurrent summary requests are coalesced; a refresh after a write supersedes earlier responses. Confirmed validation changes update immediately, while a summary refresh runs separately. Quiet comment polling does not overlap an in-flight read, and posting invalidates earlier reads so they cannot erase a newly saved comment.

Rate limiting still uses atomic claims across function instances. Each post lists the current minute's occupied slots before claiming a free one, avoiding repeated failed uploads to earlier slots. The ten-comments-per-minute limit, request idempotency, and expired-slot cleanup remain in place.

## Deployment

1. Import `DuarteCaldeira/tooling` into Vercel. Set **Root Directory** to `dashboard`, **Framework Preset** to **Other**, **Node.js** to **22.x**, and **Production Branch** to `main`.
2. Set **APPS_READ_TOKEN** in each applicable Vercel environment to a fine-grained PAT with **Contents: read** for the configured app repositories and tooling. Renew it before expiration. Never prefix it with `VITE_` or otherwise expose it to the browser. GitHub App tokens require a token-renewal mechanism at runtime.
3. Connect the private Blob store, supplying **BLOB_READ_WRITE_TOKEN**. Existing discussion storage can be reused. Snapshot keys include a hash of the app configuration and reviewed summaries so deployments with different configurations do not share snapshots.
4. Deploy once. `dashboard/vercel.json` runs `vite build`, serves `dist`, and publishes the release and discussion functions with their server-only configuration. Builds no longer contact GitHub or require a valid GitHub token; verify `/api/releases` after deployment to check runtime access. Configure Deployment Protection if the selected private repository metadata should have restricted access.

The existing `app-released` dispatch workflow remains compatible with app notification jobs, but only records that runtime refresh is automatic. It no longer requests builds or runs on a schedule. Notification jobs, their dispatch tokens and the old **VERCEL_DEPLOY_HOOK** secret are optional and can be removed once old pinned notification callers are retired. No new secret or notification integration is needed for automatic updates.

Existing installations need one deployment containing this change before runtime updates take effect. Remove any Vercel dashboard build-command override that still invokes the old collector.

## Local checks

```sh
node --test tests/dashboard-runtime.test.mjs tests/dashboard.test.mjs tests/discussions.test.mjs
npm --prefix dashboard run build
npm run test:dashboard:mobile
npm run test:dashboard:runtime
```

Use Vercel's development environment with the runtime secrets for a full local preview. A static-only server or plain Vite preview does not provide the release/discussion APIs. For a standalone data export, the legacy `node dashboard/collect.mjs` command still writes `.tooling/dashboard-site/data.json` with `APPS_READ_TOKEN` set; `node dashboard/build.mjs` remains an optional export/storage diagnostic, outside the deployment build path.

