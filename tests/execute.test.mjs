import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../packages/tooling/runner/execute.mjs';
import { plan } from '../packages/tooling/runner/graph.mjs';

test('broad development changes run tests without coverage while push retains coverage', async () => {
  const commands = [];
  const run = async (command) => {
    commands.push(command);
    return { status: 'passed' };
  };
  await execute(process.cwd(), plan({}, { profile: 'dev', only: ['unit'] }), { run });
  await execute(process.cwd(), plan({}, { profile: 'push', only: ['unit'] }), { run });
  assert.deepEqual(commands, [
    ['vitest', 'run'],
    ['vitest', 'run', '--coverage'],
  ]);
});

test('missing tools, platform mismatches and explicit exclusions cannot pass validation', async () => {
  const selection = plan({}, { files: ['x.scss'], skip: ['styles'] });
  const excluded = await execute(process.cwd(), selection, {
    run: async () => ({ status: 'passed' }),
  });
  assert.equal(excluded.complete, false);
  assert.equal(excluded.results.find((r) => r.id === 'styles').status, 'excluded');
  const unavailable = await execute(
    process.cwd(),
    {
      ...selection,
      excluded: [],
      checks: [
        {
          id: 'missing',
          command: ['unavailable-command'],
          tools: ['a-tool-that-does-not-exist-123'],
        },
        { id: 'browser', platforms: ['linux'] },
      ],
    },
    { platform: 'win32' },
  );
  assert.equal(unavailable.complete, false);
  assert.deepEqual(
    unavailable.results.map((r) => r.status),
    ['unavailable', 'unavailable'],
  );
});
test('failed build blocks dependent checks and bail reports unexecuted checks', async () => {
  const selection = {
    excluded: [],
    groups: ['all'],
    checks: [
      { id: 'build', command: ['node'] },
      { id: 'visual', dependsOn: ['build'] },
      { id: 'lint', command: ['node'] },
    ],
  };
  let count = 0;
  const result = await execute(process.cwd(), selection, {
    bail: true,
    run: async () => {
      count++;
      return { status: 'failed' };
    },
  });
  assert.equal(count, 1);
  assert.equal(result.complete, false);
  assert.deepEqual(
    result.results.map((r) => r.status),
    ['failed', 'unavailable', 'unavailable'],
  );
});
