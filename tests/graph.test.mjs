import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, plan, matches } from '../packages/tooling/runner/graph.mjs';
import { validateConfig } from '../packages/tooling/runner/config.mjs';

const config = {
  schemaVersion: 1,
  paths: {
    app: ['frontend/src/**', 'shared/src/**'],
    functions: ['shared/src/**', 'backend/functions/**'],
    database: ['backend/migrations/**'],
  },
};
const selected = (files, profile = 'ci') =>
  plan(config, { files, profile }).checks.map((c) => c.id);

test('documentation, SCSS, translations and mixed PRs select exact unions', () => {
  assert.deepEqual(selected(['README.md', 'docs/setup.md']), ['format']);
  assert.deepEqual(
    plan({ paths: { tooling: ['**/*config*'] } }, { files: ['docs/configuration.md'] }).checks.map(
      (c) => c.id,
    ),
    ['format'],
  );
  assert.deepEqual(selected(['frontend/src/X/X.module.scss']), ['format', 'styles']);
  assert.deepEqual(selected(['frontend/src/locales/en.json']), ['format', 'translations']);
  assert.deepEqual(selected(['docs/spec.md', 'frontend/src/X/X.module.scss']), [
    'format',
    'styles',
  ]);
  assert.deepEqual(classify(['backend/migrations/a.sql', 'shared/src/a.ts'], config), [
    'app',
    'database',
    'functions',
  ]);
  assert.ok(selected(['unknown.xyz']).includes('lighthouse'));
  for (const file of [
    'package.json',
    'frontend/package.json',
    'package-lock.json',
    'repo-tooling.config.json',
  ])
    assert.ok(selected([file]).includes('security'));
});
test('local CI and push use identical applicable check definitions', () => {
  for (const files of [
    ['README.md'],
    ['x.scss'],
    ['frontend/src/X.tsx'],
    ['package-lock.json'],
    ['.github/workflows/ci.yml'],
  ]) {
    assert.deepEqual(selected(files, 'ci'), selected(files, 'push'));
  }
  assert.deepEqual(selected(['frontend/src/X.tsx'], 'dev'), ['format', 'lint', 'styles', 'unit']);
});
test('selectors validate names and preserve dependency ordering and exclusions', () => {
  const result = plan(config, { only: ['visual'], skip: ['build'] });
  assert.deepEqual(
    result.checks.map((c) => c.id),
    ['build', 'visual'],
  );
  assert.equal(result.checks[0].excluded, true);
  assert.ok(result.excluded.includes('format'));
  assert.throws(() => plan(config, { only: ['typo'] }), /Unknown check/);
  assert.throws(() => plan({ checks: { build: { dependsOn: ['size'] } } }), /Cyclic/);
  assert.throws(
    () => plan({ checks: { build: { dependsOn: ['missing'] } } }),
    /Missing dependency/,
  );
});
test('configuration rejects misspelled and malformed rules', () => {
  assert.throws(() => validateConfig({ schemaVersion: 2 }));
  assert.throws(() => validateConfig({ schemaVersion: 1, check: {} }));
  assert.throws(() => validateConfig({ schemaVersion: 1, checks: { lint: { groups: ['typo'] } } }));
  assert.throws(() => validateConfig({ schemaVersion: 1, checks: { lint: { unknown: true } } }));
  assert.equal(matches('README.md', '**/*.md'), true);
  assert.equal(matches('src/a.ts', '*.ts'), false);
  assert.equal(matches('a[1].scss', '**/*.scss'), true);
});
