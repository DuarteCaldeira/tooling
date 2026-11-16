import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseDocument } from 'yaml';

test('workflow YAML is valid and privileged merge never checks out PR code', () => {
  for (const directory of ['.github/workflows', 'packages/tooling/templates']) {
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
  const steps = ci.jobs.checks.steps;
  const index = (name) => steps.findIndex((step) => step.name === name);
  assert.ok(index('Plan the entire PR diff') < index('Install application dependencies'));
  assert.equal(ci.on.workflow_call.inputs['lightweight-docs'].default, false);
  assert.equal(
    steps[index('Select formatter installation')].if,
    "inputs.lightweight-docs && steps.plan-info.outputs.active == 'true'",
  );
  assert.equal(
    steps[index('Install standalone formatter')].if,
    "steps.plan-info.outputs.active == 'true' && steps.install-plan.outputs.lightweight == 'true'",
  );
  assert.equal(
    steps[index('Install application dependencies')].if,
    "steps.plan-info.outputs.active == 'true' && steps.install-plan.outputs.lightweight != 'true'",
  );
  for (const name of ['Provision selected prerequisites', 'Run shared check graph'])
    assert.equal(steps[index(name)].if, "steps.plan-info.outputs.active == 'true'");
  assert.match(steps[index('Collect visual report')].if, /active == 'true'/);
  assert.ok(steps.find((step) => step.uses === 'actions/upload-artifact@v4').if.includes('active'));
  assert.equal(
    steps[index('Install matching browsers')].run,
    'node .tooling/source/packages/tooling/runner/browsers.mjs .tooling/plan.json',
  );
  const release = parseDocument(
    readFileSync('.github/workflows/release-validation.yml', 'utf8'),
  ).toJS();
  const browser = release.jobs.validate.steps.find((step) => step.name === 'Browsers');
  assert.equal(browser.if, "steps.plan-info.outputs.browsers == 'true'");
  assert.equal(browser.run, steps[index('Install matching browsers')].run);
  const summary = steps[index('Publish validation summary')];
  assert.equal(summary.if, 'always()');
  assert.match(summary.env.TOOLING_ARTIFACT_URL, /validation-artifacts/);
  assert.ok(
    steps.some(
      (step) =>
        step.uses === 'actions/cache/save@v4' && step.with.path === '.tooling/history/runs.json',
    ),
  );
  assert.ok(release.jobs.validate.steps.some((step) => step.name === 'Publish validation summary'));
});
