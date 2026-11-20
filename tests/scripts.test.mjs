import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AREAS, testsFor } from '../scripts/check-changed.mjs';
import { DEFAULT_ARGS, evalArgs, gitBashDir } from '../scripts/eval-plugin.mjs';

test('check picks the tests for the changed areas', () => {
  assert.deepEqual(testsFor(['claude/hooks/lib/stop.mjs', 'claude/core-rules.md']), [
    'claude-plugin',
  ]);
  assert.deepEqual(testsFor(['packages/tooling/release/digest.mjs']), [
    'github-release',
    'release',
  ]);
  assert.deepEqual(testsFor(['tests/git.test.mjs', '.github/workflows/ci.yml']), [
    'git',
    'workflows',
  ]);
  assert.deepEqual(testsFor(['docs/setup.md', 'claude/evals/results/x/report.html']), []);
});

test('check runs the whole suite for a clean tree or anything it cannot map', () => {
  assert.equal(testsFor([]), undefined, 'clean tree');
  for (const file of [
    'packages/tooling/runner/cli.mjs',
    'package.json',
    'scripts/check-changed.mjs',
  ])
    assert.equal(testsFor(['claude/core-rules.md', file]), undefined, file);
});

test('every test file check names exists', () => {
  const tests = new Set(readdirSync('tests').map((name) => name.replace(/\.test\.mjs$/, '')));
  for (const [prefix, names] of AREAS)
    for (const name of names) assert.ok(tests.has(name), `${prefix} → ${name}`);
});

test('eval:plugin passes the plugin, scaffold and judge flags, then the caller options', () => {
  assert.deepEqual(evalArgs('claude', ['--case', 'layout']), [
    'plugin',
    'eval',
    'claude',
    ...DEFAULT_ARGS,
    '--case',
    'layout',
  ]);
  assert.ok(DEFAULT_ARGS.includes('--scaffold'));
});

test('eval:plugin finds Git for Windows bash from git --exec-path', () => {
  const git = mkdtempSync(join(tmpdir(), 'git dir '));
  const execPath = join(git, 'mingw64', 'libexec', 'git-core');
  mkdirSync(execPath, { recursive: true });
  assert.equal(gitBashDir(execPath), undefined, 'no bash.exe yet');
  mkdirSync(join(git, 'bin'));
  writeFileSync(join(git, 'bin', 'bash.exe'), '');
  assert.equal(gitBashDir(execPath), join(git, 'bin'));
  assert.ok(existsSync(join(gitBashDir(execPath), 'bash.exe')));
});
