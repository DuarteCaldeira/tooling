import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSass, importantViolations } from '../packages/tooling/checks/sass.mjs';
import { loadConfig, validateConfig } from '../packages/tooling/runner/config.mjs';
import { plan } from '../packages/tooling/runner/graph.mjs';

const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tooling-sass-'));
  mkdirSync(join(root, 'src'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

test('important policy parses declarations and ignores comments and string contents', () => {
  const source = [
    '// !important in a comment',
    '/* !important in another comment */',
    '.sample { content: "!important"; color: red; }',
    '.actual { color: red !IMPORTANT; }',
    '.spaced { color: red ! important; }',
  ].join('\n');
  const errors = importantViolations(source, 'src/component.scss');
  assert.equal(errors.length, 2);
  assert.match(errors[0], /src\/component.scss:4:/);
  assert.match(errors[1], /src\/component.scss:5:/);
  assert.deepEqual(importantViolations(source, 'src/reset.scss', ['src/reset.scss']), []);
  assert.equal(importantViolations(source, 'src/nested/reset.scss', ['src/reset.scss']).length, 2);
});

test('Sass checking compiles all entries and combines compiler and policy failures', async (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'src/entry.scss'), '.sample { color: red; }');
  writeFileSync(join(root, 'src/component.scss'), '.sample { color: blue !important; }');
  writeFileSync(join(root, 'src/reset.scss'), '.sample { color: white !important; }');
  writeFileSync(join(root, 'src/ignored.scss'), '.sample { color: black !important; }');
  const calls = [];
  const compile = async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('second.scss')) throw new Error('Invalid Sass');
  };
  const result = await checkSass(root, {
    entrypoints: ['src/entry.scss', 'src/second.scss'],
    exclude: ['src/ignored.scss'],
    importantExceptions: ['src/reset.scss'],
  }, { compile });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.style, 'compressed');
  assert.equal(result.files, 3);
  assert.equal(result.failures.length, 2);
  assert.match(result.failures.join('\n'), /Sass compilation failed: Invalid Sass/);
  assert.match(result.failures.join('\n'), /component.scss:1:/);
});

test('missing source, empty selection and invalid SCSS cannot silently pass', async (t) => {
  const root = fixture(t);
  const compile = async () => {};
  await assert.rejects(checkSass(root, { entrypoints: ['src/entry.scss'] }, { compile }), /No SCSS files/);
  writeFileSync(join(root, 'src/broken.scss'), '.broken { color: red;');
  const result = await checkSass(root, { entrypoints: ['src/broken.scss'] }, { compile });
  assert.match(result.failures.join('\n'), /SCSS parsing failed/);
  await assert.rejects(checkSass(root, {
    source: 'absent', entrypoints: ['src/broken.scss'],
  }, { compile }));
});

test('Sass is opt-in, rejects malformed policy and validates repository-relative paths', (t) => {
  assert.equal(plan({ schemaVersion: 1 }, { files: 'all' }).checks.some((c) => c.id === 'sass'), false);
  const config = { schemaVersion: 1, sass: { entrypoints: ['src/entry.scss'] } };
  validateConfig(config);
  assert.equal(plan(config, { files: ['src/component.scss'] }).checks.filter((c) => c.id === 'sass').length, 1);
  assert.throws(() => validateConfig({ schemaVersion: 1, sass: { entrypoints: [] } }));
  assert.throws(() => validateConfig({ schemaVersion: 1, sass: { entrypoints: ['src/entry.scss'], typo: true } }));
  const root = fixture(t);
  writeFileSync(join(root, 'tooling.config.json'), JSON.stringify({
    schemaVersion: 1, sass: { entrypoints: ['../outside.scss'] },
  }));
  assert.throws(() => loadConfig(root), /outside repository/);
});
