# Shared preview, package and visual helpers

These helpers were extracted from design-system. Consumer repositories keep
their build commands, required artifacts, baseline paths and release policy.
The package adds no runtime dependencies.

| Helper | Arguments |
| --- | --- |
| `runner/serve-static.mjs` | `<directory> [port] [required-file]` |
| `checks/package.mjs` | `<required-build-file> [...]` |
| `checks/playwright-summary.mjs` | `[results-json] [artifact-name] [report-path]` |
| `checks/visual-compare.mjs` | `<base-ref> <output-directory> <snapshot-directory> [results-directory]` |
| `release/prepare.mjs` | `[patch\|minor\|major]`, or `RELEASE_LEVEL` |

Invoke these with `node node_modules/@dcaldeira/tooling/<helper>`.
The static server binds to loopback, serves an existing build, supports HEAD
requests and rejects escaping symlinks and malformed URLs. It has no TLS,
compression or SPA fallback. Pass `index.json` as the required file for
Storybook, or keep `index.html` for a website build.

The package smoke check requires explicit artifact paths and verifies that
`npm pack --ignore-scripts` produces exactly one archive. Build before calling
it. This does not validate archive contents or run package lifecycle scripts.
It removes its temporary archive on success or failure.

The Playwright summary consumes the JSON reporter output and emits Markdown.
The visual comparison reports committed additions, changes and removals
against a Git ref, plus failed actual screenshots. Baselines must use
`<project>/<snapshot>.png` under the configured snapshot directory; actual
screenshots must retain Playwright's `<test>-<project>/<snapshot>-actual.png`
layout. Hyphenated project names are supported. Generate canonical baselines
with the consumer's existing Linux workflow. The output directory must not
overlap the source snapshots or test results.

The release preparer now accepts an argument as well as its existing
environment variable and creates `.tooling/` itself. It still requires a
clean checkout and commits only `release.files`. Signed release evidence and
publication remain separate concerns.

## Adoption

Design-system uses the preview server, package smoke check, failure summary,
baseline report and shared release preparer. Its emoji generator and Sass
entry/important guard remain application-owned.

The visual suites in website-baseline, dr-gabriela-videira and billy can reuse
the JSON summary. They currently use a different snapshot layout, so the
baseline comparison needs a deliberate layout adapter before adoption.

Rookie's frontend/serve-dist helper is not equivalent to the preview server:
it supplies HTTP/2, TLS, gzip, asset caching and SPA fallback for Lighthouse.
Keep that behaviour until the shared tooling explicitly supports it.
Other consumers are candidates; this extraction does not modify them.

## Configurable Sass compilation and important policy

Enable the opt-in `sass` check in the shared graph, independently of the
existing structural `styles` linter:

```json
{
  "schemaVersion": 1,
  "sass": {
    "source": "src",
    "entrypoints": ["src/styles/globals.scss"],
    "include": ["**/*.scss"],
    "exclude": [],
    "importantExceptions": ["src/styles/reset.scss"]
  }
}
```

Install Sass and postcss-scss in the consumer; Sass is an optional peer.
`node node_modules/@dcaldeira/tooling/checks/sass.mjs` runs the same check
directly for focused feedback. All configured entrypoints are compiled without
emitting files. SCSS declarations are parsed, so comment/string occurrences of
`!important` do not cause false positives, while real declarations report file
and line. Exceptions use repository-relative glob patterns; an exact reset
path does not grant an exception to other files with that basename.

Missing directories, empty selections, parse errors and failed compilations
cannot pass. The checker reports compilation and declaration errors together.
Source symlinks are rejected rather than silently traversed or skipped.
No policies are applied to existing consumers until `sass` is configured or
the check is explicitly enabled. The structural SCSS lint preset remains a
separate capability.

Component accessibility tests stay in their consumer's unit-test suite.
Run that suite once in validation, include style changes in its selection when
they can affect accessibility, and keep a focused Vitest alias for local use.
This is separate from tooling's rendered-page accessibility scanner.
