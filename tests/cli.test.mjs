import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { git } from '../packages/tooling/runner/git.mjs';
import { builtins } from '../packages/tooling/runner/graph.mjs';

const cli = fileURLToPath(new URL('../packages/tooling/runner/cli.mjs', import.meta.url));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tooling-cli-'));
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.com');
  const config = {
    schemaVersion: 1,
    checks: Object.fromEntries(Object.keys(builtins).map((id) => [id, false])),
  };
  config.checks.format = {
    command: ['node', '-e', 'process.exit(0)'],
    groups: ['docs'],
    profiles: ['dev', 'push', 'ci'],
  };
  writeFileSync(join(root, 'repo-tooling.config.json'), JSON.stringify(config));
  writeFileSync(join(root, 'README.md'), 'base');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return root;
}
const run = (root, ...args) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 20000 });

test('CLI records complete clean passes, reuses them and rejects dirty/stale or narrowed validation', () => {
  const root = fixture();
  let result = run(root, '--profile=push', '--all');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Pass recorded/);
  assert.equal(run(root, '--profile=push', '--all').status, 0);
  writeFileSync(join(root, 'untracked.md'), 'new');
  result = run(root, '--profile=push', '--all');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No pass recorded/);
  result = run(root, '--profile=ci', '--all', '--skip=format');
  assert.equal(result.status, 1);
  const report = JSON.parse(readFileSync(join(root, '.git/repo-tooling/report/summary.json')));
  assert.equal(report.complete, false);
  assert.equal(report.results[0].status, 'excluded');
  assert.equal(run(root, '--profile=push', '--committed', '--all').status, 2);
});

test('a cached docs-only pass cannot authorize a subsequent full validation request', () => {
  const root = fixture();
  const path = join(root, 'repo-tooling.config.json');
  const config = JSON.parse(readFileSync(path));
  config.checks.app = {
    command: ['node', '-e', 'process.exit(1)'],
    groups: ['app'],
    profiles: ['push', 'ci'],
  };
  writeFileSync(path, JSON.stringify(config));
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'configure app check');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(join(root, 'README.md'), 'docs edit');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'docs');
  assert.equal(run(root, '--profile=push', '--changed').status, 0);
  assert.equal(run(root, '--profile=push', '--all').status, 1);
});
test('plan is read-only and unknown flags/ids cannot silently pass', () => {
  const root = fixture();
  const result = run(root, '--all', '--plan');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout).checks.map((c) => c.id),
    ['format'],
  );
  assert.equal(existsSync(join(root, '.git/repo-tooling')), false);
  assert.equal(run(root, '--only=typo').status, 2);
  assert.equal(run(root, '--wat').status, 1);
  git(root, 'commit', '--allow-empty', '-m', 'next');
  assert.equal(run(root, '--profile=push', '--changed', '--base=HEAD').status, 2);
});
