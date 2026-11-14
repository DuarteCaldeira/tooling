import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseDocument } from 'yaml';

test('workflow YAML is valid and privileged merge never checks out PR code', () => {
  for (const directory of ['.github/workflows', 'templates']) {
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.yml'))) {
      const doc = parseDocument(readFileSync(`${directory}/${file}`, 'utf8'), { uniqueKeys: true });
      assert.deepEqual(doc.errors, [], `${directory}/${file}`);
      assert.equal(doc.toJS().on !== undefined || file === 'dependabot.yml', true);
      for (const job of Object.values(doc.toJS().jobs ?? {})) {
        for (const step of job.steps ?? []) {
          if (step.with?.script) {
            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
            assert.doesNotThrow(
              () =>
                new AsyncFunction('github', 'context', 'core', 'exec', 'require', step.with.script),
              `${directory}/${file}`,
            );
          }
        }
      }
    }
  }
  const merge = readFileSync('.github/workflows/dependabot-merge.yml', 'utf8');
  assert.equal(merge.includes('actions/checkout'), false);
  assert.ok(merge.includes('--match-head-commit'));
  const ci = parseDocument(readFileSync('.github/workflows/ci.yml', 'utf8')).toJS();
  assert.equal(ci.jobs.result.if, 'always()');
  assert.equal(ci.permissions.contents, 'read');
});
