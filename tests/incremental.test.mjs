import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { builtins, plan } from '../packages/tooling/runner/graph.mjs';
import { checkCache } from '../packages/tooling/runner/cache.mjs';
import { git, toolIdentity } from '../packages/tooling/runner/git.mjs';
import { execute } from '../packages/tooling/runner/execute.mjs';
import { planMetadata } from '../packages/tooling/runner/ci-plan.mjs';
import { provisionBrowsers } from '../packages/tooling/runner/browsers.mjs';
import { validateConfig } from '../packages/tooling/runner/config.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'tooling-incremental-'));
function put(root, name, value) {
  mkdirSync(dirname(join(root, name)), { recursive: true });
  writeFileSync(join(root, name), value);
}
const off = () => Object.fromEntries(Object.keys(builtins).map((id) => [id, false]));
const workspaceConfig = () => ({
  schemaVersion: 1,
  workspaces: {
    web: { paths: ['apps/web/**'], dependsOn: ['ui'] },
    admin: { paths: ['apps/admin/**'], dependsOn: ['ui'] },
    ui: { paths: ['packages/ui/**'], dependsOn: ['tokens'] },
    tokens: { paths: ['packages/tokens/**'] },
  },
  checks: {
    ...off(),
    format: {},
    'web-lint': { extends: 'lint', cwd: 'apps/web', workspaces: ['web'] },
    'admin-lint': { extends: 'lint', cwd: 'apps/admin', workspaces: ['admin'] },
  },
});

test('workspace selection propagates transitive dependencies and respects docs/style-only unions', () => {
  const config = workspaceConfig();
  validateConfig(config);
  const selected = (files) => plan(config, { files }).checks.map((c) => c.id);
  assert.deepEqual(selected(['apps/web/src/App.tsx']), ['format', 'web-lint']);
  assert.deepEqual(selected(['packages/tokens/src/index.ts']), [
    'format',
    'web-lint',
    'admin-lint',
  ]);
  assert.deepEqual(selected(['apps/admin/src/App.tsx', 'apps/web/README.md']), [
    'format',
    'admin-lint',
  ]);
  assert.deepEqual(selected(['apps/web/src/App.scss']), ['format']);
  assert.deepEqual(selected(['README.md']), ['format']);
  assert.deepEqual(selected(['src/unassigned.ts']), ['format', 'web-lint', 'admin-lint']);
  for (const file of ['package-lock.json', 'tooling.config.json', 'unmapped.file'])
    assert.equal(selected([file]).length, 3);
  assert.deepEqual(plan(config, { files: ['apps/web/src/App.tsx'] }).affectedWorkspaces, ['web']);
  assert.deepEqual(
    plan(config, { files: ['packages/ui/src/index.ts'] }).checks.find((c) => c.id === 'web-lint')
      .files,
    ['packages/ui/src/index.ts'],
  );
  assert.deepEqual(
    plan(config, { files: ['apps/web/src/App.tsx'], profile: 'ci' }).checks,
    plan(config, { files: ['apps/web/src/App.tsx'], profile: 'push' }).checks,
  );
  config.workspaces.tokens.dependsOn = ['web'];
  assert.throws(() => plan(config), /Cyclic workspaces/);
  config.workspaces.tokens.dependsOn = ['missing'];
  assert.throws(() => plan(config), /Unknown workspace/);
});

test('check cache reuses successes across unrelated edits but invalidates all declared controls', () => {
  const root = temp();
  const config = workspaceConfig();
  const selection = plan(config, { files: ['apps/web/src/a.ts'] });
  const check = selection.checks.find((c) => c.id === 'web-lint');
  const base = {
    context: 'context',
    tools: [],
    files: {
      'apps/web/src/a.ts': 'a',
      'apps/admin/src/b.ts': 'b',
      'packages/ui/src/index.ts': 'ui',
      'package-lock.json': 'lock',
      '.gitignore': 'ignore',
    },
  };
  let cache = checkCache(root, config, selection, base);
  assert.equal(cache.get(check, check.command, []), null);
  cache.commit([{ id: check.id, status: 'passed' }]);
  const hit = (state) => checkCache(root, config, selection, state).get(check, check.command, []);
  assert.equal(hit(base).cached, true);
  assert.equal(
    hit({ ...base, files: { ...base.files, 'apps/admin/src/b.ts': 'other' } }).cached,
    true,
  );
  for (const file of [
    'apps/web/src/a.ts',
    'packages/ui/src/index.ts',
    'package-lock.json',
    '.gitignore',
  ])
    assert.equal(hit({ ...base, files: { ...base.files, [file]: 'changed' } }), null, file);
  assert.equal(hit({ ...base, context: 'changed env/tooling/config' }), null);
  assert.equal(hit({ ...base, files: { ...base.files, 'apps/web/src/new.ts': 'new' } }), null);
  const missing = { ...base, files: { ...base.files } };
  delete missing.files['packages/ui/src/index.ts'];
  assert.equal(hit(missing), null);
  assert.equal(
    checkCache(root, config, selection, base, { disabled: true }).get(check, check.command, []),
    null,
  );
  for (const kind of ['security', 'build', 'unit', 'e2e', 'visual', 'lighthouse'])
    assert.equal(cache.get({ ...check, kind, cache: true }, ['node'], []), null);
  const failed = { ...check, id: 'failed', cache: true };
  assert.equal(cache.get(failed, failed.command, []), null);
  cache.commit([{ id: 'failed', status: 'failed' }]);
  assert.equal(checkCache(root, config, selection, base).get(failed, failed.command, []), null);
});

test('CLI caching survives unrelated edits, bypasses on demand and does not certify changed inputs', () => {
  const root = temp();
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.com');
  const config = {
    schemaVersion: 1,
    checks: {
      ...off(),
      diagnostic: {
        command: ['node', 'counter.mjs'],
        groups: ['app'],
        profiles: ['dev', 'push', 'ci'],
        cache: { inputs: ['src/**', 'counter.mjs'] },
      },
    },
  };
  put(root, 'tooling.config.json', JSON.stringify(config));
  put(root, '.gitignore', '.tooling/\n');
  put(root, 'src/a.ts', 'base');
  put(
    root,
    'counter.mjs',
    `import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';mkdirSync('.tooling',{recursive:true});let n=0;try{n=Number(readFileSync('.tooling/count','utf8'))}catch{}writeFileSync('.tooling/count',String(n+1));`,
  );
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  put(root, 'src/a.ts', 'edit');
  const cli = fileURLToPath(new URL('../packages/tooling/runner/cli.mjs', import.meta.url));
  const run = (...args) =>
    spawnSync(process.execPath, [cli, '--profile=dev', '--changed', ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
    });
  const count = () => Number(readFileSync(join(root, '.tooling/count'), 'utf8'));
  assert.equal(run().status, 0);
  assert.equal(count(), 1);
  assert.equal(run().status, 0);
  assert.equal(count(), 1);
  put(root, 'README.md', 'unrelated docs');
  assert.equal(run().status, 0);
  assert.equal(count(), 1);
  put(root, 'src/a.ts', 'another edit');
  assert.equal(run().status, 0);
  assert.equal(count(), 2);
  assert.equal(run('--no-cache').status, 0);
  assert.equal(count(), 3);
  const oldScript = readFileSync(join(root, 'counter.mjs'), 'utf8');
  put(root, 'counter.mjs', oldScript + `writeFileSync('src/a.ts','modified during validation');`);
  assert.equal(run().status, 1);
  const report = JSON.parse(readFileSync(join(root, '.tooling/report/summary.json'), 'utf8'));
  assert.equal(report.complete, false);
  assert.equal(report.results.at(-1).id, 'inputs');
});

test('empty CLI plans skip installation, report writes and pass recording', () => {
  const root = temp();
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.com');
  put(root, 'README.md', 'base');
  put(root, 'tooling.config.json', JSON.stringify({ schemaVersion: 1, checks: off() }));
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  const cli = fileURLToPath(new URL('../packages/tooling/runner/cli.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--profile=dev', '--changed', '--install'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No applicable checks/);
  assert.equal(existsSync(join(root, '.tooling')), false);
});

test('an unchanged clean push still reruns security instead of reusing the whole pass', () => {
  const root = temp();
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.com');
  put(root, '.gitignore', '.tooling/\n');
  put(root, 'src/a.ts', 'base');
  put(
    root,
    'security.mjs',
    `import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';mkdirSync('.tooling',{recursive:true});let n=0;try{n=Number(readFileSync('.tooling/security-count','utf8'))}catch{}writeFileSync('.tooling/security-count',String(n+1));`,
  );
  put(
    root,
    'tooling.config.json',
    JSON.stringify({
      schemaVersion: 1,
      checks: { ...off(), security: { command: ['node', 'security.mjs'], tools: [], cache: true } },
    }),
  );
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  put(root, 'src/a.ts', 'edit');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'app');
  const cli = fileURLToPath(new URL('../packages/tooling/runner/cli.mjs', import.meta.url));
  for (let n = 1; n <= 2; n++) {
    const result = spawnSync(process.execPath, [cli, '--profile=push', '--changed'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(Number(readFileSync(join(root, '.tooling/security-count'), 'utf8')), n);
  }
});

test('npm tool identities read package metadata without executing --version and detect replacements', () => {
  const root = temp();
  put(
    root,
    'node_modules/vitest/package.json',
    JSON.stringify({ name: 'vitest', version: '1', bin: { vitest: 'bin.mjs' } }),
  );
  put(root, 'node_modules/vitest/bin.mjs', `throw new Error('must never execute');`);
  const first = toolIdentity(root, 'vitest');
  assert.equal(JSON.parse(first.manifest).version, '1');
  put(
    root,
    'node_modules/vitest/package.json',
    JSON.stringify({ name: 'vitest', version: '2', bin: { vitest: 'bin.mjs' } }),
  );
  assert.notDeepEqual(toolIdentity(root, 'vitest'), first);
  assert.equal(toolIdentity(root, 'node').version, process.version);
});

test('browser provisioning skips unused suites and handles Lighthouse-only and workspace browser checks', async () => {
  const root = temp();
  const commands = [];
  const mocks = {
    run: async (command, _root, options) => {
      commands.push({ command, cwd: options.cwd });
      return { status: 'passed' };
    },
    manifest: () => 'locked-playwright',
    load: () => ({ chromium: { executablePath: () => '/cache/chromium' } }),
    find: () => null,
    env: {},
  };
  assert.deepEqual(await provisionBrowsers(root, { checks: [{ id: 'format' }] }, mocks), {});
  assert.equal(commands.length, 0);
  assert.deepEqual(
    await provisionBrowsers(
      root,
      { checks: [{ id: 'lighthouse' }] },
      { ...mocks, find: () => ['/usr/bin/google-chrome'] },
    ),
    { CHROME_PATH: '/usr/bin/google-chrome' },
  );
  assert.equal(commands.length, 0);
  const result = await provisionBrowsers(
    root,
    {
      checks: [
        { id: 'web-e2e', kind: 'e2e', cwd: 'apps/web' },
        { id: 'web-visual', kind: 'visual', cwd: 'apps/web' },
        { id: 'lighthouse' },
      ],
    },
    mocks,
  );
  assert.equal(commands.length, 1);
  assert.equal(commands[0].cwd, resolve(root, 'apps/web'));
  assert.equal(result.CHROME_PATH, '/cache/chromium');
  await assert.rejects(
    () =>
      provisionBrowsers(
        root,
        { checks: [{ id: 'lighthouse' }] },
        { ...mocks, manifest: () => null },
      ),
    /Lighthouse requires/,
  );
  assert.deepEqual(
    await provisionBrowsers(root, { checks: [{ id: 'e2e', excluded: true }] }, mocks),
    {},
  );
});

test('plan metadata keeps empty gates active when exclusions exist and keys browsers by their versions', () => {
  const root = temp();
  const empty = plan({ checks: off() }, { files: [] });
  const info = planMetadata(root, empty, {});
  assert.equal(info.active, 'false');
  assert.equal(info.browsers, 'false');
  assert.equal(planMetadata(root, { ...empty, excluded: ['required'] }, {}).active, 'true');
  const selected = { ...empty, checks: [{ id: 'lighthouse' }] };
  const lock = {
    packages: {
      'node_modules/playwright-core': { version: '1' },
      'node_modules/react': { version: '1' },
    },
  };
  const before = planMetadata(
    root,
    selected,
    { execution: { typeScriptBuildInfo: ['frontend/no-emit.tsbuildinfo'] } },
    lock,
  );
  lock.packages['node_modules/react'].version = '2';
  assert.equal(planMetadata(root, selected, {}, lock)['browser-key'], before['browser-key']);
  lock.packages['node_modules/playwright-core'].version = '2';
  assert.notEqual(planMetadata(root, selected, {}, lock)['browser-key'], before['browser-key']);
  assert.match(before['tool-cache-paths'], /no-emit.tsbuildinfo/);
  assert.throws(
    () =>
      planMetadata(root, selected, {
        execution: { typeScriptBuildInfo: ['../outside.tsbuildinfo'] },
      }),
    /outside/,
  );
});

test('cached dependency failures remain blocking and --no-cache disables ESLint/TypeScript reuse', async () => {
  const root = temp();
  const commands = [];
  const selection = {
    profile: 'ci',
    files: 'all',
    groups: ['all'],
    excluded: [],
    checks: [
      { id: 'types', command: ['tsc', '--build'] },
      { id: 'lint', command: ['eslint', '.', '--cache', '--cache-strategy', 'content'] },
    ],
  };
  const result = await execute(root, selection, {
    toolCache: false,
    run: async (command) => {
      commands.push(command);
      return { status: 'passed' };
    },
  });
  assert.equal(result.complete, true);
  assert.ok(commands.find((c) => c[0] === 'tsc').includes('--force'));
  assert.ok(!commands.find((c) => c[0] === 'eslint').includes('--cache'));
  const blocked = await execute(
    root,
    {
      ...selection,
      checks: [
        { id: 'build', command: ['node'] },
        { id: 'visual', dependsOn: ['build'], command: ['node'] },
      ],
    },
    { cache: { get: () => null }, run: async () => ({ status: 'failed' }) },
  );
  assert.equal(blocked.results[1].status, 'unavailable');
});
