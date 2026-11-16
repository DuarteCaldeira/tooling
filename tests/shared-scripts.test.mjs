import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { staticServer } from '../packages/tooling/runner/serve-static.mjs';
import { checkPackage } from '../packages/tooling/checks/package.mjs';
import { playwrightSummary } from '../packages/tooling/checks/playwright-summary.mjs';
import { buildHtml } from '../packages/tooling/checks/visual-report-html.mjs';

const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tooling-shared-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

test('static preview serves GET/HEAD and rejects invalid URLs, methods and escaping symlinks', async (t) => {
  const root = fixture(t);
  const served = join(root, 'public');
  mkdirSync(served);
  writeFileSync(join(served, 'index.html'), '<h1>Preview</h1>');
  writeFileSync(join(root, 'secret.txt'), 'private');
  symlinkSync(join(root, 'secret.txt'), join(served, 'escape.txt'));
  const server = staticServer(served);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(url)).text(), '<h1>Preview</h1>');
  assert.equal(await (await fetch(url, { method: 'HEAD' })).text(), '');
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(url + '/%ZZ')).status, 400);
  assert.equal((await fetch(url + '/escape.txt')).status, 403);
  assert.equal((await fetch(url + '/missing.txt')).status, 404);
});

test('package smoke checking keeps required-file policy in the consumer and cleans temporary archives', async (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'entry.mjs'), 'export {};');
  await assert.rejects(checkPackage(root, []), /Specify required/);
  await assert.rejects(checkPackage(root, ['missing.mjs']), /missing.mjs/);
  await assert.rejects(checkPackage(root, ['../escape']), /outside repository/);
  let destination;
  const run = async (command, cwd) => {
    assert.equal(cwd, root);
    assert.deepEqual(command.slice(0, 3), ['npm', 'pack', '--ignore-scripts']);
    destination = command.at(-1);
    writeFileSync(join(destination, 'fixture-1.0.0.tgz'), 'archive');
    return { status: 'passed' };
  };
  assert.equal(await checkPackage(root, ['entry.mjs'], run), 'fixture-1.0.0.tgz');
  assert.equal(existsSync(destination), false);
  await assert.rejects(checkPackage(root, ['entry.mjs'], async () => ({ status: 'failed' })), /packing failed/);
});

test('Playwright summaries preserve nested stories and escape Markdown table cells', () => {
  assert.equal(playwrightSummary({ suites: [] }), '');
  const summary = playwrightSummary({ suites: [{
    title: 'Library', suites: [{ title: 'Nested', specs: [{
      title: 'Story | unsafe', ok: false, tests: [{ projectName: 'mobile' }],
    }] }],
  }] }, { artifact: 'screenshots', report: 'report/index.html' });
  assert.match(summary, /Library › Nested › Story &#124; unsafe/);
  assert.match(summary, /screenshots/);
  assert.match(summary, /report\/index.html/);
  assert.doesNotMatch(summary, /pnpm/);
});

test('visual comparison accepts consumer paths and hyphenated project names', (t) => {
  const root = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  const snapshots = join(root, 'custom-baselines', 'chrome-mobile');
  mkdirSync(snapshots, { recursive: true });
  const png = Buffer.alloc(24);
  png.writeUInt32BE(2, 16);
  png.writeUInt32BE(3, 20);
  writeFileSync(join(snapshots, 'story.png'), png);
  git('add', '.');
  git('commit', '-m', 'baseline');
  const results = join(root, 'custom-results', 'story-chrome-mobile');
  mkdirSync(results, { recursive: true });
  const actual = Buffer.from(png);
  actual[0] = 1;
  writeFileSync(join(results, 'story-actual.png'), actual);
  const cli = fileURLToPath(new URL('../packages/tooling/checks/visual-compare.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  const result = run('HEAD', 'comparison', 'custom-baselines', 'custom-results');
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(root, 'comparison/index.html'), 'utf8'), /Failing test/);
  assert.match(readFileSync(join(root, 'comparison/comment.md'), 'utf8'), /1 changed/);
  assert.notEqual(run('HEAD', '.', 'custom-baselines', 'custom-results').status, 0);
  assert.equal(existsSync(join(snapshots, 'story.png')), true);
});

test('visual HTML escapes story names and ref labels', () => {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(1, 16);
  png.writeUInt32BE(1, 20);
  const html = buildHtml({
    entries: [{ file: 'mobile/<script>.png', status: 'added', before: null, after: png }],
    counts: { added: 1, changed: 0, removed: 0 },
    baseRef: '<untrusted>',
  });
  assert.match(html, /&#60;script&#62;/);
  assert.match(html, /&#60;untrusted&#62;/);
});
