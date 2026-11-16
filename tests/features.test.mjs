import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  utimesSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { analyseArchitecture } from '../packages/tooling/checks/architecture.mjs';
import { analyseDependencies } from '../packages/tooling/checks/dependencies.mjs';
import { scanAccessibility } from '../packages/tooling/checks/a11y.mjs';
import { generateFiles, writeGenerated } from '../packages/tooling/runner/generate.mjs';
import {
  collectMetrics,
  historyText,
  performanceHistory,
  readHistory,
} from '../packages/tooling/runner/insights.mjs';
import { markdownSummary } from '../packages/tooling/runner/summary.mjs';
import { plan } from '../packages/tooling/runner/graph.mjs';
import { validateConfig } from '../packages/tooling/runner/config.mjs';
import { browserChecks } from '../packages/tooling/runner/browsers.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'tooling-features-'));
function put(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
}
const json = (root, path, value) => put(root, path, JSON.stringify(value));

test('architecture resolves aliases, enforces layers and public entries, and finds cycles', () => {
  const root = temp();
  json(root, 'tsconfig.json', {
    compilerOptions: {
      module: 'ESNext',
      moduleResolution: 'Bundler',
      baseUrl: '.',
      paths: { '@ui/*': ['src/ui/*'] },
    },
  });
  const files = [
    'src/app/main.ts',
    'src/ui/button.ts',
    'src/features/cart/index.ts',
    'src/features/cart/private.ts',
    'src/shared/a.ts',
    'src/shared/b.ts',
  ];
  put(
    root,
    files[0],
    `import {button} from '@ui/button'; import {secret} from '../features/cart/private'; import './styles.scss';`,
  );
  put(root, files[1], `export {secret as button} from '../features/cart/private';`);
  put(root, files[2], `export {secret} from './private';`);
  put(root, files[3], 'export const secret = 1;');
  put(root, files[4], `import type {B} from './b'; export type A = B;`);
  put(root, files[5], `import type {A} from './a'; export type B = A;`);
  const settings = {
    layers: [
      { name: 'app', paths: ['src/app/**'], allow: ['ui', 'features'] },
      { name: 'ui', paths: ['src/ui/**'], allow: [] },
      { name: 'features', paths: ['src/features/**'], allow: [] },
    ],
    modules: [{ name: 'cart', root: 'src/features/cart', public: ['src/features/cart/index.ts'] }],
  };
  let result = analyseArchitecture(root, settings, files, ts);
  assert.ok(result.issues.some((issue) => issue.rule === 'import-boundary'));
  assert.ok(result.issues.some((issue) => issue.rule === 'private-module'));
  assert.ok(result.issues.some((issue) => issue.rule === 'circular-import'));
  assert.ok(!result.issues.some((issue) => issue.rule === 'unresolved-import'));
  put(root, files[0], `import {secret} from '../features/cart';`);
  put(root, files[1], 'export const button = 1;');
  put(root, files[5], 'export type B = string;');
  result = analyseArchitecture(root, settings, files, ts);
  assert.deepEqual(result.issues, []);
  put(root, files[0], `import './missing';`);
  assert.ok(
    analyseArchitecture(root, settings, files, ts).issues.some(
      (issue) => issue.rule === 'unresolved-import',
    ),
  );
});

test('dependency consistency catches incompatible ranges, strict drift, duplicate locks and undeclared imports', () => {
  const root = temp();
  const manifests = ['package.json', 'apps/web/package.json', 'packages/ui/package.json'];
  json(root, manifests[0], {
    name: 'root',
    private: true,
    workspaces: ['apps/*', 'packages/*'],
    devDependencies: { react: '^18.0.0' },
  });
  json(root, manifests[1], {
    name: '@app/web',
    version: '1.0.0',
    dependencies: { react: '^19.0.0' },
  });
  json(root, manifests[2], {
    name: '@app/ui',
    version: '1.0.0',
    peerDependencies: { react: '^19.0.0' },
  });
  put(root, 'apps/web/src/index.ts', `import {value} from '@app/ui';`);
  const lock = {
    packages: {
      'node_modules/react': { version: '18.3.0' },
      'apps/web/node_modules/react': { version: '19.0.0' },
    },
  };
  let result = analyseDependencies(
    root,
    { strict: ['react'], singleVersion: ['react'] },
    manifests,
    lock,
    ['apps/web/src/index.ts'],
    ts,
  );
  for (const rule of [
    'incompatible-ranges',
    'version-drift',
    'duplicate-versions',
    'undeclared-workspace-import',
  ])
    assert.ok(
      result.issues.some((issue) => issue.rule === rule),
      rule,
    );
  json(root, manifests[0], { name: 'root', private: true, devDependencies: { react: '^19.0.0' } });
  json(root, manifests[1], {
    name: '@app/web',
    version: '1.0.0',
    dependencies: { react: '^19.0.0', '@app/ui': 'workspace:^' },
  });
  result = analyseDependencies(
    root,
    { strict: ['react'], expected: { react: '>=19 <20' } },
    manifests,
    { packages: {} },
    ['apps/web/src/index.ts'],
    ts,
  );
  assert.deepEqual(result.issues, []);
  put(root, 'packages/ui/src/index.ts', 'export const value = 1;');
  put(root, 'apps/web/src/index.ts', `import {value} from '../../../packages/ui/src';`);
  result = analyseDependencies(
    root,
    {},
    manifests,
    { packages: {} },
    ['apps/web/src/index.ts'],
    ts,
  );
  assert.ok(result.issues.some((issue) => issue.rule === 'workspace-path-import'));
});

test('generators create parseable React/TypeScript templates and protect all existing files', () => {
  const root = temp();
  const files = generateFiles(root, 'component', { name: 'UserCard' });
  writeGenerated(root, files, { dryRun: true });
  assert.equal(existsSync(join(root, 'src')), false);
  for (const [path, content] of files)
    if (/\.tsx?$/.test(path)) {
      const parsed = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
      assert.deepEqual(parsed.parseDiagnostics, [], path);
    }
  put(root, 'src/components/UserCard/UserCard.module.scss', 'existing');
  assert.throws(() => writeGenerated(root, files), /overwrite/);
  assert.equal(existsSync(join(root, 'src/components/UserCard/UserCard.tsx')), false);
  const hook = generateFiles(root, 'hook', { name: 'useProfile', path: 'frontend/src/hooks' });
  writeGenerated(root, hook);
  assert.ok(existsSync(join(root, 'frontend/src/hooks/useProfile.ts')));
  assert.throws(() => generateFiles(root, 'component', { name: '../escape' }));
  assert.throws(
    () => generateFiles(root, 'hook', { name: 'useBad', path: '../outside' }),
    /outside/,
  );
  assert.throws(
    () => generateFiles(root, 'component', { name: 'Card', designSystem: true }),
    /Configure/,
  );
  const ds = generateFiles(
    root,
    'component',
    { name: 'Card', designSystem: true },
    { generators: { designSystem: { package: '@dcaldeira/design-system', component: 'Box' } } },
  );
  assert.match(ds.get('src/components/Card/Card.tsx'), /Box as Primitive/);
});

test('accessibility scans accumulate violations, gate errors and clean up browsers and servers', async () => {
  const calls = [];
  const page = {
    goto: async () => ({ ok: () => true }),
    url: () => 'http://localhost:4173/',
    locator: () => ({
      waitFor: async () => {},
      click: async () => {
        calls.push('click');
      },
    }),
    close: async () => calls.push('page-close'),
  };
  const context = { newPage: async () => page, close: async () => calls.push('context-close') };
  const chromium = {
    launch: async () => ({
      newContext: async () => context,
      close: async () => calls.push('browser-close'),
    }),
  };
  class Axe {
    withTags() {
      return this;
    }
    async analyze() {
      return {
        violations: [
          {
            id: 'button-name',
            impact: 'critical',
            help: 'Buttons need a name',
            nodes: [{ target: ['button'] }],
          },
        ],
        incomplete: [],
        passes: [],
      };
    }
  }
  const result = await scanAccessibility(
    {
      baseURL: 'http://localhost:4173',
      routes: [{ path: '/', actions: [{ type: 'click', selector: 'button' }] }],
      server: { command: ['node', 'server.mjs'] },
    },
    {
      root: temp(),
      chromium,
      AxeBuilder: Axe,
      server: async () => async () => calls.push('server-stop'),
    },
  );
  assert.equal(result.complete, false);
  assert.equal(result.failures, 1);
  assert.deepEqual(calls, ['click', 'page-close', 'context-close', 'browser-close', 'server-stop']);
  page.goto = async () => {
    throw new Error('Navigation failed');
  };
  const failed = await scanAccessibility(
    { baseURL: 'http://localhost:4173', routes: [{ path: '/' }] },
    { chromium, AxeBuilder: Axe },
  );
  assert.equal(failed.complete, false);
  assert.equal(failed.errors.length, 1);
});

function report(overrides = {}) {
  return {
    schemaVersion: 1,
    version: '0.1.0',
    profile: 'ci',
    groups: ['app'],
    required: ['unit'],
    results: [{ id: 'unit', kind: 'unit', status: 'passed', milliseconds: 100 }],
    commit: 'a'.repeat(40),
    configuration: 'config',
    node: '22',
    platform: 'linux',
    complete: true,
    wallMilliseconds: 200,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    metrics: {},
    ...overrides,
  };
}

test('metrics collect current coverage and slow tests, combine suites and exclude stale outputs', () => {
  const root = temp(),
    output = join(root, '.tooling/report');
  json(output, 'unit-results/vitest.json', {
    testResults: [
      {
        assertionResults: [
          { title: 'slow save', duration: 900 },
          { title: 'quick', duration: 1 },
        ],
      },
    ],
  });
  json(output, 'unit-results/coverage/coverage-summary.json', {
    total: { lines: { pct: 80, total: 10, covered: 8 } },
  });
  json(output, 'e2e-results/results.json', { stats: { expected: 3, unexpected: 0 }, suites: [] });
  json(output, 'visual-results/results.json', {
    stats: { expected: 2, unexpected: 1 },
    suites: [],
  });
  json(output, 'size.details.json', { bundle: { initialKB: 120 } });
  const current = report({
    results: [
      ...report().results,
      { id: 'e2e', kind: 'e2e', status: 'passed' },
      { id: 'visual', kind: 'visual', status: 'failed' },
      { id: 'size', kind: 'size', status: 'passed' },
    ],
  });
  const metrics = collectMetrics(root, output, current);
  assert.equal(metrics.coverage.lines, 80);
  assert.equal(metrics.bundle.initialKB, 120);
  assert.equal(metrics.slowTests[0].name, 'slow save');
  assert.equal(metrics.browser.passed, 5);
  assert.equal(metrics.browser.failed, 1);
  const stale = join(output, 'size.details.json');
  utimesSync(stale, new Date(0), new Date(0));
  assert.equal(collectMetrics(root, output, current).bundle, undefined);
  assert.equal(
    collectMetrics(
      root,
      output,
      report({ results: [{ id: 'unit', kind: 'unit', status: 'excluded' }] }),
    ).coverage,
    undefined,
  );
});

test('history stays bounded, compares like-for-like runs and reports regressions without gating', () => {
  const root = temp();
  for (let i = 0; i < 3; i++) performanceHistory(root, report(), { limit: 4 });
  const insight = performanceHistory(
    root,
    report({
      wallMilliseconds: 500,
      results: [{ id: 'unit', status: 'passed', milliseconds: 300 }],
    }),
    { limit: 4 },
  );
  assert.equal(insight.previousMs, 200);
  assert.equal(insight.regressions[0].id, 'unit');
  performanceHistory(root, report({ profile: 'dev' }), { limit: 4 });
  assert.equal(readHistory(root).length, 4);
  assert.match(historyText(root), /dev/);
  assert.equal(
    performanceHistory(root, report({ groups: ['docs'] }), { enabled: false }).previousMs,
    null,
  );
  assert.equal(readHistory(root).length, 4);
  json(root, '.tooling/history/runs.json', { schemaVersion: 1, runs: [{ profile: 42 }] });
  assert.deepEqual(readHistory(root), []);
});

test('PR summaries show failures and metrics and escape injected Markdown/HTML', () => {
  const markdown = markdownSummary(
    report({
      complete: false,
      results: [
        {
          id: 'unit',
          status: 'failed',
          reason: '<script>bad</script> | ![x](https://tracker.invalid)',
        },
      ],
      metrics: {
        bundle: { initialKB: 123 },
        coverage: { lines: 82.5 },
        slowTests: [{ name: 'Slow case', milliseconds: 1000 }],
      },
    }),
    { artifactURL: 'https://github.com/org/repo/actions/runs/1/artifacts/2' },
  );
  assert.match(markdown, /incomplete or failed/);
  assert.match(markdown, /82.5%/);
  assert.match(markdown, /Slow case/);
  assert.match(markdown, /123.0 KB/);
  assert.ok(!markdown.includes('<script>'));
  assert.ok(!markdown.includes('![x]'));
  assert.match(markdown, /Download validation reports/);
});

test('new checks are opt-in and preserve docs/style routing and canonical browser provisioning', () => {
  assert.ok(
    !plan({}, { files: ['src/App.tsx'] }).checks.some((check) =>
      ['a11y', 'architecture', 'dependency-consistency'].includes(check.id),
    ),
  );
  const config = {
    schemaVersion: 1,
    architecture: { include: ['src/**'] },
    dependencyConsistency: {},
    a11y: { baseURL: 'http://localhost:4173', routes: [{ path: '/' }] },
  };
  validateConfig(config);
  const selected = plan(config, { files: ['src/App.tsx'] });
  for (const id of ['architecture', 'a11y', 'dependency-consistency'])
    assert.ok(selected.checks.some((check) => check.id === id));
  assert.ok(browserChecks(selected).some((check) => check.id === 'a11y'));
  assert.deepEqual(
    plan(config, { files: ['README.md'] }).checks.map((check) => check.id),
    ['format'],
  );
  assert.deepEqual(
    plan(config, { files: ['src/App.scss'] }).checks.map((check) => check.id),
    ['format', 'styles'],
  );
  assert.throws(
    () =>
      validateConfig({
        ...config,
        architecture: { layers: [{ name: 'ui', paths: ['src/ui/**'], allow: ['missing'] }] },
      }),
    /Unknown architecture layer/,
  );
});
