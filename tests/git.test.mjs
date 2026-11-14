import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, changedFiles, snapshot } from '../packages/tooling/runner/git.mjs';

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'repo-tooling-test-'));
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(root, 'README.md'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  return root;
}

test('entire PR diff includes tracked, staged and untracked paths including spaces', () => {
  const root = repository(),
    base = git(root, 'rev-parse', 'HEAD');
  writeFileSync(join(root, 'a.ts'), 'a');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'app');
  writeFileSync(join(root, 'README.md'), 'edit');
  writeFileSync(join(root, 'staged.scss'), 'a');
  git(root, 'add', 'staged.scss');
  writeFileSync(join(root, 'a file.ts'), 'untracked');
  assert.deepEqual(changedFiles(root, base), ['README.md', 'a file.ts', 'a.ts', 'staged.scss']);
  assert.deepEqual(changedFiles(root, base, { committed: true }), ['a.ts']);
});
test('fingerprints invalidate edits, untracked files, commits, base, config, tooling and declared environment', () => {
  const root = repository(),
    base = git(root, 'rev-parse', 'HEAD');
  const context = { base, version: '0.1.0', config: '{}' };
  const first = snapshot(root, context);
  assert.equal(snapshot(root, context), first);
  for (const modified of [{ version: '0.2.0' }, { config: '{"x":1}' }])
    assert.notEqual(snapshot(root, { ...context, ...modified }), first);
  writeFileSync(join(root, 'new file'), 'new');
  const second = snapshot(root, context);
  assert.notEqual(first, second);
  writeFileSync(join(root, 'new file'), 'changed');
  assert.notEqual(snapshot(root, context), second);
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'next');
  const third = snapshot(root, context);
  assert.notEqual(third, second);
  assert.notEqual(snapshot(root, { ...context, base: 'HEAD' }), third);
  process.env.REPO_TOOLING_TEST_INPUT = 'a';
  const fourth = snapshot(root, { ...context, environment: ['REPO_TOOLING_TEST_INPUT'] });
  process.env.REPO_TOOLING_TEST_INPUT = 'b';
  assert.notEqual(snapshot(root, { ...context, environment: ['REPO_TOOLING_TEST_INPUT'] }), fourth);
  delete process.env.REPO_TOOLING_TEST_INPUT;
});
