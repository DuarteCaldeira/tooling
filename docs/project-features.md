# Project features

## Architecture

Install the project's TypeScript compiler and enable `architecture` in `tooling.config.json`:

```json
{
  "architecture": {
    "include": ["src/**"],
    "exclude": ["src/generated/**"],
    "tsconfig": "tsconfig.json",
    "cycles": true,
    "layers": [
      {
        "name": "app",
        "paths": ["src/app/**", "src/pages/**"],
        "allow": ["features", "ui", "shared"]
      },
      { "name": "features", "paths": ["src/features/**"], "allow": ["ui", "shared"] },
      { "name": "ui", "paths": ["src/components/**"], "allow": ["shared"] },
      { "name": "shared", "paths": ["src/shared/**"], "allow": [] }
    ],
    "modules": [
      {
        "name": "account",
        "root": "src/features/account",
        "public": ["src/features/account/index.ts"]
      }
    ]
  }
}
```

The checker parses JavaScript/TypeScript/TSX with the installed TypeScript compiler and resolves aliases through the selected tsconfig. It includes static imports, re-exports, literal dynamic imports, `require()` and type imports. The first matching layer owns a file; same-layer imports are allowed. Files outside a named layer still participate in cycle detection. Imports into a configured module from outside its root must resolve to a public entry. Missing local code imports, parse errors and an empty source selection fail the check. Common stylesheet/image imports are excluded from the code graph. Nonliteral dynamic imports cannot form a static edge.

Paths are relative to the repository. For a nested app, set its source globs and `tsconfig` explicitly. `architecture` runs in dev, push and CI profiles when applicable. It is opt-in; existing consumers keep their current check selection until configured.

## Rendered accessibility

Install `@playwright/test` and `@axe-core/playwright` as consumer dev dependencies, and configure the built app's routes:

```json
{
  "a11y": {
    "baseURL": "http://127.0.0.1:4173",
    "server": {
      "command": ["npm", "run", "preview", "--", "--host", "127.0.0.1"],
      "timeout": 30000
    },
    "routes": [
      { "name": "Home", "path": "/", "waitFor": "main" },
      { "name": "Contact", "path": "/contact", "waitFor": "form" }
    ],
    "viewports": [
      { "name": "desktop", "width": 1280, "height": 720 },
      { "name": "mobile", "width": 390, "height": 844 }
    ],
    "tags": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    "failImpacts": ["minor", "moderate", "serious", "critical"]
  }
}
```

The optional server command runs in the foreground, waits for a successful HTTP response and is stopped after scanning, including failure paths. Set `server.cwd` for a nested app. Without `server`, the supplied base URL must already be running. Routes stay on that origin, including redirects; use an ignored `storageState` file for authenticated pages. Its contents enter the input fingerprint without appearing in reports. Optional route `actions` support `click`, `fill` and `press` with a selector; fill/press also require `value`. Route `include`/`exclude` lists narrow the axe scan. `waitFor` waits for a visible selector before scanning or performing actions.

Every route is scanned at each viewport. Violations, element selectors and rules requiring manual review appear in the check's JSON details. Configured blocking impacts and navigation/scan errors fail validation. The gate follows build and shares the browser resource lock with browser tests/Lighthouse. Canonical CI uses Linux and the consumer's locked Playwright browser. Browser and axe prerequisites are reported by `tooling doctor`. Browser/server processes started by the checker are cleaned up after execution.

## Dependency consistency

```json
{
  "dependencyConsistency": {
    "strict": ["react", "react-dom"],
    "singleVersion": ["react", "react-dom"],
    "include": ["**/src/**"],
    "checkImports": true
  }
}
```

The checker discovers the root manifest and npm workspaces, or accepts an explicit `manifests` list. It detects incompatible semantic-version ranges, strict range drift, duplicate workspace names, local workspace version/target mismatches, undeclared workspace imports and relative/aliased imports that cross workspace package boundaries. Shared workspace packages should be imported by their declared package name.

`expected` can map dependencies to allowed semver ranges; declarations must be subsets of that policy. `ignore` exempts deliberately independent dependencies from version consistency. Multiple versions in the npm lockfile are recorded as notices; `singleVersion` promotes selected packages to errors. Import checks use TypeScript resolution from each package's tsconfig; configure project aliases there. `checkImports: false` limits the check to manifest/lockfile analysis. The check runs in push/CI profiles and remains fresh rather than using a cached success.

## Component and hook generators

```sh
tooling generate component --name=UserCard --dry-run
tooling generate component --name=UserCard --path=frontend/src/components
tooling generate hook --name=useProfile --path=frontend/src/hooks
tooling generate component --name=UserCard --design-system
```

Components include named exports, typed props, a CSS module, an index and a Vitest/Testing Library smoke test. Hooks include a generic state scaffold and a test to replace as domain logic is added. Generated tests use jsdom, React, Vitest and `@testing-library/react`; install these in the target project. SCSS compilation also requires Sass in the target build setup. Component names use PascalCase and hook names start with `use`. Existing files are checked before writing any output. Paths must stay inside the repository, including symlink destinations. Dry-run prints the exact file contents without writing them.

Optional settings:

```json
{
  "generators": {
    "components": "frontend/src/components",
    "hooks": "frontend/src/hooks",
    "designSystem": { "package": "@your-scope/design-system", "component": "Box" }
  }
}
```

Set the design-system package and an actual exported component that accepts `className`, children and DOM attributes. The generator does not guess your package's exports. Rookie's component-name style convention is preserved when that preset is enabled.

## PR summaries and metrics

Every validation report now includes `summary.md` beside its HTML and JSON. PR and release workflows publish it to the GitHub Actions summary with an artifact download link. It includes selected checks, failures, cache reuse, timings, affected workspaces and available bundle, coverage, browser, accessibility, architecture and dependency metrics. Visual expected/actual/diff images remain in the Playwright report within the artifact. No PR comments or additional write permissions are required. Empty plans explain why work was skipped; prerequisite failures still point reviewers to the failed step.

Merge the shared Vitest/Playwright presets to collect JSON results automatically. The runner gives unit/browser checks separate output directories. For existing application-specific reporters, supply repository-relative files:

```json
{
  "reporting": {
    "unit": ["frontend/test-results/vitest.json"],
    "coverage": ["frontend/coverage/coverage-summary.json"],
    "playwright": ["frontend/test-results/results.json"],
    "slowTestMilliseconds": 500
  }
}
```

Only recently written reports from checks that actually ran contribute metrics. Old coverage/browser outputs are not carried into docs-only validation. Coverage counters are combined by covered/total counts where available. Browser suite counts are accumulated, and repeated references to the same report are deduplicated.

## Performance history

```sh
tooling history
tooling history --limit=10
```

Validation records bounded data under ignored `.tooling/history/runs.json`: wall/check durations, cache hits, bundle size, coverage and slow tests. Defaults retain the latest 200 runs. Comparable medians use the same profile, selected checks, change groups, configuration, Node version, platform and cache-hit pattern. Per-check regressions require at least three uncached successful samples; failed and cached runs cannot become an uncached timing baseline. Timing observations do not change check outcomes.

```json
{
  "history": { "enabled": true, "limit": 200, "regressionPercent": 25 }
}
```

The CI/release workflows restore/save only this data file separately from check-success records. GitHub cache branch scopes keep PR history separate from the default branch; restored data never authorizes a validation pass. Set `history.enabled: false` to stop recording. Empty plans and the whole-pass shortcut do not create history entries.

## Testing this repository

```sh
npm ci --ignore-scripts
npm test
npx --no-install playwright install --with-deps chromium
npm run test:browser
```

Unit tests cover the new policies, generators, summary escaping, history retention and failure paths. Browser integration tests cover rendered DOM with real axe and served-page scans. The tooling workflow runs browser integration on Linux. In a restricted environment that blocks local HTTP, `TOOLING_SKIP_NETWORK_TESTS=1` explicitly skips only the served-page test; the in-memory rendered DOM test still runs.
