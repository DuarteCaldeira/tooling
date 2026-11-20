import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execute, executable, invoke } from '../packages/tooling/runner/execute.mjs';
import { plan, builtins } from '../packages/tooling/runner/graph.mjs';
import { validateConfig } from '../packages/tooling/runner/config.mjs';
import { initialize, diagnose, starterConfig } from '../packages/tooling/runner/setup.mjs';
import { formatterLock } from '../packages/tooling/runner/docs-install.mjs';
import { analyseBundle, staticImports } from '../packages/tooling/checks/bundle.mjs';
import { git } from '../packages/tooling/runner/git.mjs';
import { relevantChanges, watchChanges } from '../packages/tooling/runner/watch.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'tooling-regression-'));
function put(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const turn = () => new Promise((resolve) => setImmediate(resolve));

test('bounded concurrency respects dependencies, resource locks and stable report order', async () => {
  const checks = [
    { id: 'build', command: ['build'] },
    { id: 'lint', command: ['lint'] },
    { id: 'e2e', command: ['e2e'], dependsOn: ['build'], resources: ['browser'] },
    { id: 'visual', command: ['visual'], dependsOn: ['build'], resources: ['browser'] },
  ];
  const gates = Object.fromEntries(checks.map((c) => [c.id, deferred()]));
  const started = [];
  const task = execute(
    process.cwd(),
    { groups: ['all'], excluded: [], checks },
    {
      concurrency: 2,
      run: async ([id]) => {
        started.push(id);
        await gates[id].promise;
        return { status: 'passed' };
      },
    },
  );
  await turn();
  assert.deepEqual(started, ['build', 'lint']);
  gates.build.resolve();
  await turn();
  assert.deepEqual(started, ['build', 'lint', 'e2e']);
  gates.lint.resolve();
  await turn();
  assert.equal(started.includes('visual'), false);
  gates.e2e.resolve();
  await turn();
  assert.equal(started.at(-1), 'visual');
  gates.visual.resolve();
  const result = await task;
  assert.equal(result.complete, true);
  assert.deepEqual(
    result.results.map((r) => r.id),
    checks.map((c) => c.id),
  );
});

test('concurrent bail drains in-flight checks, blocks downstream work and catches invocation errors', async () => {
  const gate = deferred();
  const started = [];
  const task = execute(
    process.cwd(),
    {
      groups: ['all'],
      excluded: [],
      checks: [
        { id: 'bad', command: ['bad'] },
        { id: 'inflight', command: ['inflight'] },
        { id: 'next', command: ['next'] },
        { id: 'dependent', dependsOn: ['bad'], command: ['dependent'] },
      ],
    },
    {
      concurrency: 2,
      bail: true,
      run: async ([id]) => {
        started.push(id);
        if (id === 'bad') throw new Error('launch failed');
        await gate.promise;
        return { status: 'passed' };
      },
    },
  );
  await turn();
  gate.resolve();
  const result = await task;
  assert.deepEqual(started, ['bad', 'inflight']);
  assert.equal(result.complete, false);
  assert.deepEqual(
    result.results.map((r) => r.status),
    ['unavailable', 'passed', 'unavailable', 'unavailable'],
  );
  await assert.rejects(
    () => execute('.', { checks: [], excluded: [], groups: [] }, { concurrency: 0 }),
    /Concurrency/,
  );
});

test('workspace binaries prefer local packages and fall back to hoisted tools', async () => {
  const root = temp();
  put(root, 'node_modules/vitest/package.json', JSON.stringify({ bin: { vitest: 'cli.mjs' } }));
  put(root, 'node_modules/vitest/cli.mjs', 'process.exit(0)');
  put(
    root,
    'frontend/node_modules/vitest/package.json',
    JSON.stringify({ bin: { vitest: 'local.mjs' } }),
  );
  put(root, 'frontend/node_modules/vitest/local.mjs', 'process.exit(7)');
  mkdirSync(join(root, 'backend'));
  assert.equal(
    executable(join(root, 'backend'), 'vitest')[1],
    join(root, 'node_modules/vitest/cli.mjs'),
  );
  assert.equal(
    (await invoke(['vitest'], root, { cwd: join(root, 'frontend'), quiet: true })).code,
    7,
  );
  assert.equal(
    (await invoke(['vitest'], root, { cwd: join(root, 'backend'), quiet: true })).status,
    'passed',
  );
  for (const id of ['styles', 'translations']) assert.ok(existsSync(builtins[id].command[1]));
  assert.deepEqual(builtins.e2e.command.slice(-2), ['--grep-invert', '@visual']);
});

test('runtime schema rejects malformed nested settings and accepts configurable presets', () => {
  for (const invalid of [
    { styles: { maxDepth: -1 } },
    { styles: { maxSpecificity: [0, 1] } },
    { styles: { rules: { typo: true } } },
    { styles: { rules: { bem: 'yes' } } },
    { translations: [] },
    { translations: { directory: 'locales' } },
    { budgets: { bundle: { dist: 'dist', initialKB: -1, chunkKB: 1 } } },
    {
      budgets: {
        bundle: { dist: 'dist', initialKB: 1, chunkKB: 1, vendors: [['react', 'react', 'huge']] },
      },
    },
    { release: { prepare: [], files: [] } },
    { checks: [] },
    { paths: [] },
    { checks: { lint: { command: '' } } },
    { execution: { concurrency: 17 } },
  ])
    assert.throws(() => validateConfig({ schemaVersion: 1, ...invalid }), JSON.stringify(invalid));
  validateConfig({
    schemaVersion: 1,
    execution: { concurrency: 3 },
    styles: { preset: 'standard', rules: { bem: true }, colourTokenPaths: ['tokens/**'] },
  });
});

test('bundle budgets include transitive initial imports once, respect base URLs and exclude lazy imports', () => {
  const root = temp();
  put(
    root,
    'dist/index.html',
    `<script type='module' src='/app/assets/main.js?v=1'></script><link rel="modulepreload" href="./assets/shared.js"><script src="https://cdn.example/external.js"></script>`,
  );
  put(
    root,
    'dist/assets/main.js',
    `import './shared.js'; import('./lazy.js'); export { value } from './nested/extra.js';`,
  );
  put(root, 'dist/assets/shared.js', `import './nested/extra.js'; export const shared = 1;`);
  put(root, 'dist/assets/nested/extra.js', `import '../shared.js'; export const value = 1;`);
  put(root, 'dist/assets/lazy.js', `export const lazy = 'lazy';`);
  const result = analyseBundle(root, { dist: 'dist', initialKB: 100, chunkKB: 100 });
  assert.deepEqual([...result.initial].sort(), [
    'assets/main.js',
    'assets/nested/extra.js',
    'assets/shared.js',
  ]);
  assert.equal(result.errors.length, 0);
  assert.equal(
    analyseBundle(root, { dist: 'dist', initialKB: 0.01, chunkKB: 100 }).errors.length,
    1,
  );
  // A file without a source map (a pre-built worker) gets its own allowance by path.
  put(root, 'dist/assets/map-worker-abc.js', randomBytes(4096).toString('base64'));
  const tight = { dist: 'dist', initialKB: 100, chunkKB: 1 };
  assert.match(analyseBundle(root, tight).errors.join('\n'), /map-worker-abc\.js \(route chunk\)/);
  assert.deepEqual(
    analyseBundle(root, { ...tight, files: [['map-worker-', 'map worker', 100]] }).errors,
    [],
  );
  put(root, 'dist/index.html', '<script src="/app/assets/missing.js"></script>');
  assert.throws(
    () => analyseBundle(root, { dist: 'dist', initialKB: 100, chunkKB: 100 }),
    /Missing local/,
  );
  assert.deepEqual(
    staticImports(
      `/* import './fake.js' */ const s="import './fake.js'"; const re=/import 'fake'/; import.meta.url; import('./lazy.js'); export * from './real.js'; import './\\u0061.js';`,
    ),
    ['./real.js', './a.js'],
  );
});

test('init creates small safe projects, preserves user settings and doctor reports missing prerequisites', () => {
  const root = temp();
  const original = { name: 'app', scripts: { build: 'vite build', lint: 'eslint src' } };
  put(root, 'package.json', JSON.stringify(original));
  put(root, 'prettier.config.mjs', 'export default { semi: false };');
  initialize(root, { toolingSha: 'a'.repeat(40) });
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  assert.equal(pkg.scripts.lint, original.scripts.lint);
  assert.equal(pkg.devDependencies['@dcaldeira/tooling'], '0.2.1');
  assert.equal(
    readFileSync(join(root, 'prettier.config.mjs'), 'utf8'),
    'export default { semi: false };',
  );
  assert.match(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'), /a{40}/);
  const config = JSON.parse(readFileSync(join(root, 'tooling.config.json')));
  assert.equal(config.checks.visual, false);
  assert.equal(config.checks.lint.command[2], 'lint');
  const before = readFileSync(join(root, 'package.json'), 'utf8');
  assert.throws(() => initialize(root), /Refusing to overwrite/);
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), before);
  assert.ok(diagnose(root).some((f) => f.message.includes('package-lock.json')));
  const workspace = starterConfig({ preset: 'workspace', app: 'apps/web' });
  assert.equal(workspace.checks.unit.cwd, 'apps/web');
  assert.deepEqual(workspace.paths.app, ['apps/web/src/**', 'shared/src/**']);
  assert.throws(() => starterConfig({ preset: 'workspace', app: '../outside' }));
});

test('lightweight docs install keeps exact lock integrity and never handles custom or mixed checks', () => {
  const root = temp();
  const entry = {
    version: '3.9.10',
    resolved: 'https://registry.npmjs.org/prettier/-/prettier-3.9.10.tgz',
    integrity: 'sha512-example',
    dev: true,
  };
  put(root, 'package-lock.json', JSON.stringify({ packages: { 'node_modules/prettier': entry } }));
  const selection = plan({}, { files: ['README.md'] });
  assert.equal(
    formatterLock(root, selection).packages['node_modules/prettier'].integrity,
    entry.integrity,
  );
  assert.equal(formatterLock(root, plan({}, { files: ['README.md', 'src/App.tsx'] })), null);
  assert.equal(
    formatterLock(
      root,
      plan(
        { checks: { format: { command: ['npm', 'run', 'format:check'] } } },
        { files: ['README.md'] },
      ),
    ),
    null,
  );
});

test('watch filtering includes ignored declared inputs and excludes generated output and dependency changes', async () => {
  const root = temp();
  git(root, 'init');
  put(root, '.gitignore', 'dist/\n.env\n');
  put(root, 'dist/output.js', 'generated');
  put(root, 'src/app.ts', 'source');
  put(root, '.env', 'SECRET=value');
  assert.deepEqual(
    relevantChanges(
      root,
      [
        'src/app.ts',
        'dist/output.js',
        'node_modules/a/index.js',
        '.tooling/report/summary.json',
        '.env',
      ],
      ['.env'],
    ),
    ['src/app.ts', '.env'],
  );
  const controller = new AbortController();
  let count = 0;
  const initial = deferred();
  const changed = deferred();
  const watcher = watchChanges(
    root,
    async () => {
      count++;
      if (count === 1) initial.resolve();
      else changed.resolve();
    },
    { signal: controller.signal, debounce: 10 },
  );
  try {
    await initial.promise;
    put(root, 'src/app.ts', 'edited');
    await changed.promise;
    assert.ok(count >= 2);
  } finally {
    controller.abort();
    await watcher;
  }
});

test('SCSS standard preset accepts project naming and palette; Rookie retains its conventions', () => {
  const root = temp();
  const checker = fileURLToPath(
    new URL('../packages/tooling/checks/lint-scss.mjs', import.meta.url),
  );
  put(root, 'src/styles.scss', '.camelCase {\n  color: red;\n}\n');
  put(
    root,
    'tooling.config.json',
    JSON.stringify({ schemaVersion: 1, styles: { preset: 'standard' } }),
  );
  const run = () =>
    spawnSync(process.execPath, [checker], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, TOOLING_CONFIG_PATH: 'tooling.config.json' },
    });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  put(
    root,
    'tooling.config.json',
    JSON.stringify({ schemaVersion: 1, styles: { preset: 'rookie' } }),
  );
  result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /selector-class-pattern/);
  assert.match(result.stderr, /color-named/);
});
