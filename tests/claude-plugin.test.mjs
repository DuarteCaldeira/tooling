import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStack } from '../claude/hooks/lib/detect.mjs';
import { bashBlockReason, blockReason } from '../claude/hooks/lib/guard-rules.mjs';
import {
  markCommand,
  recordEdit,
  stopCheck,
  takeEdits,
  validationCommand,
} from '../claude/hooks/lib/stop.mjs';
import { hasFrontend, repoStandardFindings } from '../packages/tooling/runner/repo-standard.mjs';
import { diagnose } from '../packages/tooling/runner/setup.mjs';
import { plan } from '../packages/tooling/runner/graph.mjs';

// The full plugin set a frontend repo enables (caveman stays in user settings).
const ALL_PLUGINS = {
  enabledPlugins: Object.fromEntries(
    [
      'core@dcaldeira',
      'mattpocock-skills@mattpocock',
      'ui-ux-pro-max@ui-ux-pro-max-skill',
      'taste-skill@taste-skill',
    ].map((id) => [id, true]),
  ),
};
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(repo, 'claude');
// Fixture paths contain a space, like real Windows home folders.
const temp = () => mkdtempSync(join(tmpdir(), 'claude plugin '));
function put(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
}
const git = (root, ...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
function gitRepo() {
  const root = temp();
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  put(root, 'a.txt', 'a');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'init');
  return root;
}
/** Write `path` in `root` and record it as Claude's edit for `session`. */
function edit(root, path, session, stateDir) {
  put(root, path, `edit ${Math.random()}`);
  recordEdit({ session_id: session, cwd: root, tool_input: { file_path: path } }, { stateDir });
}
const hook = (script, input) =>
  spawnSync(process.execPath, [join(plugin, 'hooks', script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });

test('guard blocks secrets, lockfiles and build output but allows env templates', () => {
  for (const path of [
    '.env',
    'apps/web/.env.local',
    'C:\\Some Dir\\repo\\.env.production',
    'package-lock.json',
    'bun.lockb',
    'dist/index.js',
    'frontend/coverage/lcov.info',
  ])
    assert.ok(blockReason(path), path);
  for (const path of [
    '.env.example',
    'apps/web/.env.sample',
    'src/env.ts',
    'src/distance.ts',
    'docs/dist.md',
    undefined,
  ])
    assert.equal(blockReason(path), undefined, String(path));
});

test('guard hook denies through PreToolUse output and stays silent otherwise', () => {
  const denied = hook('guard.mjs', { tool_input: { file_path: '/repo/.env' } });
  assert.equal(denied.status, 0);
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const allowed = hook('guard.mjs', { tool_input: { file_path: '/repo/src/App.tsx' } });
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, '');
});

test('stack detection reads workspace packages', () => {
  const flat = temp();
  put(flat, 'package.json', { devDependencies: { vite: '8' } });
  assert.deepEqual(detectStack(flat).stacks, ['vite']);

  const expo = temp();
  put(expo, 'package.json', { workspaces: ['apps/*', 'packages/*'] });
  put(expo, 'apps/health/package.json', { dependencies: { expo: '55' } });
  put(expo, 'tooling.config.json', {});
  assert.deepEqual(detectStack(expo), {
    js: true,
    stacks: ['expo'],
    where: { expo: ['apps/health'], frontend: ['apps/health'] },
    frontend: true,
    tooling: true,
  });

  const full = temp();
  put(full, 'package.json', { workspaces: ['frontend', 'backend', 'shared'] });
  put(full, 'frontend/package.json', { devDependencies: { vite: '8' } });
  put(full, 'backend/package.json', {});
  mkdirSync(join(full, 'backend/supabase'), { recursive: true });
  assert.deepEqual(detectStack(full).stacks, ['vite', 'supabase']);
  assert.deepEqual(detectStack(full).where.supabase, ['backend']);

  assert.deepEqual(detectStack(temp()), { js: false, stacks: [] });
});

test('session start injects rules and stack in JS repos and nothing elsewhere', () => {
  const root = temp();
  put(root, 'package.json', { devDependencies: { vite: '8' } });
  const result = hook('session-start.mjs', { cwd: root });
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /Core rules/);
  assert.match(context, /Detected stack: vite/);
  assert.match(context, /core:react-conventions/);
  assert.match(context, /\*\*Frontend\*\*/);
  assert.doesNotMatch(context, /<!--/);
  assert.equal(hook('session-start.mjs', { cwd: temp() }).stdout, '');
});

test('session start finds a JS project below a git root without package.json', () => {
  const root = temp();
  mkdirSync(join(root, '.git'));
  put(root, 'app/package.json', { devDependencies: { vite: '8' } });
  const result = hook('session-start.mjs', { cwd: join(root, 'app') });
  assert.match(
    JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
    /Detected stack: vite\./,
  );
});

test('session start leaves frontend rules out of non-frontend repos', () => {
  const root = temp();
  put(root, 'package.json', { devDependencies: { typescript: '6' } });
  const context = JSON.parse(hook('session-start.mjs', { cwd: root }).stdout).hookSpecificOutput
    .additionalContext;
  assert.match(context, /\*\*Code\*\*/);
  assert.match(context, /\*\*Tests\*\*/);
  assert.doesNotMatch(context, /Frontend|ui-ux-pro-max|Stack|<!--/);
  assert.doesNotMatch(context, /\n{3,}/);
});

test('stop check skips clean trees, turns without Claude edits and unchanged trees', async () => {
  const stateDir = temp();
  const root = gitRepo();
  assert.equal(await stopCheck({ cwd: root }, { stateDir }), undefined);
  assert.equal(await stopCheck({ cwd: temp() }, { stateDir }), undefined);
  put(root, 'b.txt', 'b');
  assert.equal(await stopCheck({ cwd: root, session_id: 's' }, { stateDir }), undefined);
  assert.equal(readdirSync(stateDir).length, 0, "the user's own changes are not checked");
  edit(root, 'b.txt', 's', stateDir);
  assert.equal(await stopCheck({ cwd: root, session_id: 's' }, { stateDir }), undefined);
  assert.equal(readdirSync(stateDir).length, 1, 'records the checked tree');
});

test('stop check blocks on tooling failure and reports a timeout as unfinished', async () => {
  const root = gitRepo();
  put(root, 'tooling.config.json', { checks: { format: {} } });
  const bin = 'node_modules/@dcaldeira/tooling';
  put(root, `${bin}/package.json`, { bin: { tooling: 'cli.mjs' } });
  put(root, '.gitignore', 'node_modules\n');

  put(root, `${bin}/cli.mjs`, 'console.log(process.argv.slice(2).join(" ")); process.exit(1);');
  const failState = temp();
  edit(root, 'a.txt', 'fail', failState);
  const failed = await stopCheck({ cwd: root, session_id: 'fail' }, { stateDir: failState });
  assert.equal(failed.decision, 'block');
  assert.match(failed.reason, /--profile=dev --changed --skip=format/);
  // The failed tree is not remembered as checked: the re-check blocks again.
  recordEdit(
    { cwd: root, session_id: 'fail', tool_input: { file_path: join(root, 'a.txt') } },
    { stateDir: failState },
  );
  const again = await stopCheck(
    { cwd: root, session_id: 'fail', stop_hook_active: true },
    { stateDir: failState },
  );
  assert.equal(again?.decision, 'block');

  // A hung run is killed with its children (test workers), not only the tooling process.
  const marker = join(root, 'orphan.txt');
  put(
    root,
    `${bin}/cli.mjs`,
    `import { spawn } from 'node:child_process';
spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 2000)`)}], { stdio: 'inherit' });
setTimeout(() => {}, 10_000);`,
  );
  const slowState = temp();
  edit(root, 'a.txt', 'slow', slowState);
  const slow = await stopCheck(
    { cwd: root, session_id: 'slow' },
    { stateDir: slowState, timeoutMs: 800 },
  );
  assert.match(slow.reason, /did not finish/);
  assert.match(slow.reason, /NOT validated/);
  await new Promise((done) => setTimeout(done, 2500));
  assert.ok(!existsSync(marker), 'child of the timed-out run kept running');
});

test('stop check formats only files Claude edited and logs tooling timings', async () => {
  const root = gitRepo();
  const stateDir = temp();
  put(root, '.gitignore', 'node_modules\n');
  put(root, 'tooling.config.json', { checks: {} });
  mkdirSync(join(root, '.tooling'));
  put(root, 'node_modules/prettier/package.json', { bin: { prettier: 'bin.cjs' } });
  put(
    root,
    'node_modules/prettier/bin.cjs',
    "require('fs').appendFileSync('formatted.log', process.argv.filter((a) => !a.startsWith('--')).slice(2).join('\\n') + '\\n');",
  );
  put(root, 'node_modules/@dcaldeira/tooling/package.json', { bin: { tooling: 'cli.mjs' } });
  put(root, 'node_modules/@dcaldeira/tooling/cli.mjs', '');

  put(root, 'mine.ts', 'user work in progress');
  put(root, 'src/claude.ts', 'claude edit');
  recordEdit(
    { session_id: 'e', cwd: root, tool_input: { file_path: 'src/claude.ts' } },
    { stateDir },
  );
  recordEdit(
    { session_id: 'e', tool_input: { file_path: join(tmpdir(), 'outside.ts') } },
    { stateDir },
  );
  assert.equal(await stopCheck({ cwd: root, session_id: 'e' }, { stateDir }), undefined);

  assert.equal(readFileSync(join(root, 'formatted.log'), 'utf8').trim(), 'src/claude.ts');
  assert.deepEqual(takeEdits('e', root, { stateDir }), [], 'edit record is cleared');
  const timing = JSON.parse(readFileSync(join(root, '.tooling/claude-stop.jsonl'), 'utf8'));
  assert.equal(timing.passed, true);
  assert.ok(Number.isInteger(timing.ms));
});

test('session start scopes stack skills and frontend rules to their folders', () => {
  const root = temp();
  put(root, 'package.json', { type: 'module' });
  put(root, 'dashboard/package.json', { devDependencies: { vite: '8', react: '19' } });
  const context = JSON.parse(hook('session-start.mjs', { cwd: root }).stdout).hookSpecificOutput
    .additionalContext;
  assert.match(context, /Detected stack: vite \(dashboard\/\)\./);
  assert.match(context, /core:react-conventions \(dashboard\/\)/);
  assert.match(context, /\*\*Frontend\*\* \(dashboard\/\)/);
  assert.match(context, /npm run check/);

  put(root, 'package.json', { devDependencies: { vite: '8' } });
  const whole = JSON.parse(hook('session-start.mjs', { cwd: root }).stdout).hookSpecificOutput
    .additionalContext;
  assert.match(whole, /Detected stack: vite\./, 'a root dependency covers the whole repo');
  assert.match(whole, /\*\*Frontend\*\*\r?\n/);
});

test('stop check re-checks a fix once, then hands verification to Claude', async () => {
  const root = gitRepo();
  const stateDir = temp();
  put(root, '.gitignore', 'node_modules\n');
  put(root, 'tooling.config.json', { checks: {} });
  const cli = 'node_modules/@dcaldeira/tooling/cli.mjs';
  put(root, 'node_modules/@dcaldeira/tooling/package.json', { bin: { tooling: 'cli.mjs' } });
  put(root, cli, 'process.exit(1);');
  const stop = (stop_hook_active) => {
    edit(root, 'src/x.ts', 'r', stateDir);
    return stopCheck({ cwd: root, session_id: 'r', stop_hook_active }, { stateDir });
  };

  assert.match((await stop(false)).reason, /re-checks once/);
  assert.match((await stop(true)).reason, /last automatic re-check/);
  assert.equal(await stop(true), undefined, 'no endless loop');
  assert.match((await stop(false)).reason, /re-checks once/, 'a new turn starts over');
  put(root, cli, '');
  assert.equal(await stop(true), undefined, 'a passing fix ends the turn');
});

test('stop check falls back to the check npm script without tooling.config.json', (t) => {
  const root = temp();
  assert.equal(validationCommand(root), undefined);
  put(root, 'package.json', { scripts: { test: 'x' } });
  assert.equal(validationCommand(root), undefined, 'only a script named check');
  put(root, 'package.json', { scripts: { check: 'node --test' } });
  const command = validationCommand(root);
  if (!command) return t.skip('npm CLI not found next to node');
  assert.equal(command.label, 'npm run check');
  assert.deepEqual(command.args, ['run', 'check']);
});

test('files a shell command writes are recorded as Claude edits', () => {
  const root = gitRepo();
  const stateDir = temp();
  const input = { tool_name: 'Bash', session_id: 'b', cwd: root };
  put(root, 'old.txt', 'user work');
  const past = new Date(Date.now() - 60_000);
  utimesSync(join(root, 'old.txt'), past, past);
  markCommand(input, { stateDir });
  put(root, 'src/new.mjs', 'written by sed');
  recordEdit(input, { stateDir });
  assert.deepEqual(takeEdits('b', root, { stateDir }), ['src/new.mjs']);
  recordEdit(input, { stateDir });
  assert.deepEqual(takeEdits('b', root, { stateDir }), [], 'no command mark, nothing recorded');
});

test('guard blocks shell writes to protected files and allows reads and package installs', () => {
  for (const command of [
    'echo KEY=1 > .env',
    'printf x >> "apps/web/.env.local"',
    'cat x | tee -a .env',
    "sed -i 's/a/b/' package-lock.json",
    'cp tmp.js dist/index.js',
    'Set-Content -Path .env -Value x',
    'Set-Content .env x',
    "'x' | Out-File -Encoding utf8 .env",
    'Add-Content package-lock.json x',
  ])
    assert.ok(bashBlockReason(command), command);
  for (const command of [
    'cat .env',
    'npm install react',
    'echo hi > notes.txt',
    'cp .env.example .env.example.bak',
    'npm test 2>&1 | tail',
    'ls > /dev/null',
    "'x' | Out-File notes.txt",
    'Set-Content notes.txt x',
    undefined,
  ])
    assert.equal(bashBlockReason(command), undefined, String(command));
  const denied = hook('guard.mjs', { tool_name: 'Bash', tool_input: { command: 'echo x > .env' } });
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('working subagents receive the rules; search-only subagents do not', () => {
  const root = temp();
  put(root, 'package.json', { devDependencies: { vite: '8' } });
  const start = (agent_type) =>
    spawnSync(process.execPath, [join(plugin, 'hooks', 'session-start.mjs'), '--subagent'], {
      input: JSON.stringify({ cwd: root, agent_type }),
      encoding: 'utf8',
    }).stdout;
  for (const agent of ['core:reviewer', 'core:tester', 'general-purpose']) {
    const output = JSON.parse(start(agent)).hookSpecificOutput;
    assert.equal(output.hookEventName, 'SubagentStart');
    assert.match(output.additionalContext, /Core rules/);
  }
  for (const agent of ['Explore', 'claude-code-guide', 'caveman:cavecrew-investigator'])
    assert.equal(start(agent), '', agent);
});

test('doctor --repo-standard checks only the standard', () => {
  const root = temp();
  const cli = join(repo, 'packages/tooling/runner/cli.mjs');
  const run = () =>
    spawnSync(process.execPath, [cli, 'doctor', '--repo-standard', `--cwd=${root}`], {
      encoding: 'utf8',
    });
  const failing = run();
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /repo standard: add AGENTS.md/);
  assert.doesNotMatch(failing.stdout, /package-lock|Configuration/);
  put(root, 'AGENTS.md', '## Repository\n## Layout\n## Commands\n## Constraints\n');
  put(root, 'CLAUDE.md', '@AGENTS.md');
  put(root, '.claude/settings.json', ALL_PLUGINS);
  assert.equal(run().status, 0);
});

test('repo standard reports drift and passes a conforming repo', () => {
  const root = temp();
  put(root, 'CLAUDE.md', 'Read .ai/workflows first');
  mkdirSync(join(root, 'ai-memory'));
  const messages = repoStandardFindings(root)
    .map((f) => f.message)
    .join('\n');
  for (const expected of [
    'add AGENTS.md',
    'only @AGENTS.md',
    'old .ai/ kit',
    'ai-memory',
    'enable core@dcaldeira',
  ])
    assert.ok(messages.includes(expected), expected);

  const good = temp();
  put(good, 'AGENTS.md', '# x\n\n## Repository\n\n## Layout\n\n## Commands\n\n## Constraints\n');
  put(good, 'CLAUDE.md', '@AGENTS.md\n');
  put(good, '.claude/settings.json', ALL_PLUGINS);
  assert.deepEqual(repoStandardFindings(good), [
    { status: 'passed', message: 'Repo standard is met' },
  ]);
});

test('UI plugins are required only in repos with a frontend', () => {
  const backend = temp();
  put(backend, 'AGENTS.md', '## Repository\n## Layout\n## Commands\n## Constraints\n');
  put(backend, 'CLAUDE.md', '@AGENTS.md');
  put(backend, 'package.json', { workspaces: ['packages/*'] });
  put(backend, 'packages/api/package.json', { dependencies: { hono: '4' } });
  put(backend, '.claude/settings.json', {
    enabledPlugins: { 'core@dcaldeira': true, 'mattpocock-skills@mattpocock': true },
  });
  assert.equal(hasFrontend(backend), false);
  assert.equal(repoStandardFindings(backend)[0].status, 'passed');

  put(backend, 'packages/web/package.json', { devDependencies: { vite: '8' } });
  assert.equal(hasFrontend(backend), true);
  const messages = repoStandardFindings(backend).map((f) => f.message);
  assert.ok(messages.some((m) => m.endsWith('must enable taste-skill@taste-skill')));
  assert.ok(!messages.some((m) => m.includes('caveman')));
});

test('plugin and doctor agree on which repos have a frontend', () => {
  const cases = [
    [{}, {}],
    [{ 'dashboard/package.json': { dependencies: { react: '19' } } }, {}],
    [{ 'web/package.json': { devDependencies: { vite: '8' } } }, {}],
    [{ 'apps/mobile/package.json': { dependencies: { expo: '55' } } }, {}],
    [{}, { peerDependencies: { react: '19' } }],
    [{ 'api/package.json': { dependencies: { hono: '4' } } }, {}],
    [{ 'node_modules/react/package.json': { dependencies: { react: '19' } } }, {}],
  ];
  const expected = [false, true, true, true, true, false, false];
  cases.forEach(([files, rootManifest], index) => {
    const root = temp();
    put(root, 'package.json', rootManifest);
    for (const [path, manifest] of Object.entries(files)) put(root, path, manifest);
    assert.equal(detectStack(root).frontend, expected[index], `plugin, case ${index}`);
    assert.equal(hasFrontend(root), expected[index], `doctor, case ${index}`);
  });
});

test('doctor runs the repo standard only when opted in', () => {
  const root = temp();
  put(root, 'tooling.config.json', { schemaVersion: 1, checks: {} });
  assert.ok(!diagnose(root).some((f) => f.message.startsWith('repo standard')));
  put(root, 'tooling.config.json', { schemaVersion: 1, repoStandard: true, checks: {} });
  assert.ok(diagnose(root).some((f) => f.message === 'repo standard: add AGENTS.md'));
});

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'results') return [];
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test('the public plugin contains no personal paths', () => {
  for (const path of files(plugin)) {
    const text = readFileSync(path, 'utf8');
    assert.doesNotMatch(
      text,
      /[A-Z]:\\Users\\|\/Users\/|\/home\/|@gmail\.com/i,
      relative(repo, path),
    );
  }
});

test('a plugin change bumps the plugin version', (t) => {
  const base = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (base.status !== 0) return t.skip('no origin/main history');
  const ref = base.stdout.trim();
  const diff = spawnSync(
    'git',
    [
      'diff',
      '--name-only',
      ref,
      '--',
      'claude',
      ':!claude/evals/results',
      ':!claude/evals/*/fixture/*',
    ],
    {
      cwd: repo,
      encoding: 'utf8',
    },
  ).stdout.trim();
  if (!diff) return;
  const before = spawnSync('git', ['show', `${ref}:claude/.claude-plugin/plugin.json`], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (before.status !== 0) return; // first release of the plugin
  const now = JSON.parse(readFileSync(join(plugin, '.claude-plugin/plugin.json'), 'utf8')).version;
  assert.notEqual(now, JSON.parse(before.stdout).version, 'bump claude/.claude-plugin/plugin.json');
});

const lintScss = join(repo, 'packages/tooling/checks/lint-scss.mjs');
const runLintScss = (root, files = []) =>
  spawnSync(process.execPath, [lintScss, ...files], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TOOLING_ROOT: root, TOOLING_CONFIG_PATH: 'tooling.config.json' },
  });

test('layoutCss reports flex layout in component modules except shared layout paths', () => {
  const root = temp();
  const config = (layoutCss) => ({
    schemaVersion: 1,
    styles: { rules: { layoutCss }, layoutPaths: ['src/layout/**'] },
  });
  const flex = '.card {\n  display: flex;\n  gap: 8px;\n}\n';
  put(root, 'src/components/Card/Card.module.scss', flex);
  put(root, 'src/layout/Shell/Shell.module.scss', flex);
  put(root, 'src/components/Grid/Grid.module.scss', '.grid {\n  display: grid;\n}\n');
  put(root, 'src/styles/globals.scss', flex);

  put(root, 'tooling.config.json', config(false));
  assert.equal(runLintScss(root).status, 0);

  put(root, 'tooling.config.json', config(true));
  const result = runLintScss(root);
  assert.equal(result.status, 1);
  const lines = result.stderr.split('\n').filter((l) => l.includes('layout-css'));
  assert.equal(lines.length, 2, result.stderr);
  assert.ok(lines.every((l) => l.includes('Card.module.scss')));
});

test('duplication reports only clones that touch changed files', () => {
  const root = temp();
  const report = {
    duplicates: [
      {
        firstFile: { name: 'src/a.ts', start: 1, end: 9 },
        secondFile: { name: 'src/b.ts', start: 3, end: 11 },
        lines: 9,
      },
      {
        firstFile: { name: 'src/old.ts', start: 1, end: 9 },
        secondFile: { name: 'src/older.ts', start: 1, end: 9 },
        lines: 9,
      },
    ],
  };
  put(root, 'tooling.config.json', { schemaVersion: 1, duplication: { paths: ['src'] } });
  put(root, 'src/a.ts', 'a');
  put(root, 'node_modules/jscpd/package.json', { bin: { jscpd: 'bin.cjs' } });
  put(
    root,
    'node_modules/jscpd/bin.cjs',
    `const out = process.argv[process.argv.indexOf('--output') + 1];
require('fs').writeFileSync(require('path').join(out, 'jscpd-report.json'), ${JSON.stringify(JSON.stringify(report))});`,
  );
  const script = join(repo, 'packages/tooling/checks/duplication.mjs');
  const run = (files = [], extraEnv = {}) =>
    spawnSync(process.execPath, [script, ...files], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        TOOLING_ROOT: root,
        TOOLING_CONFIG_PATH: 'tooling.config.json',
        TOOLING_CHANGED_FILES: '',
        ...extraEnv,
      },
    });
  // dev: changed files as arguments
  const changed = run(['src/a.ts']);
  assert.equal(changed.status, 1, changed.stderr);
  assert.match(changed.stdout, /src\/a\.ts:1-9 duplicates src\/b\.ts:3-11/);
  assert.doesNotMatch(changed.stdout, /old\.ts/);
  assert.equal(run(['src/unrelated.ts']).status, 0);

  // push/ci: changed files through a list file; legacy clones never block
  put(root, 'changed.txt', 'README.md\nsrc/unrelated.ts\n');
  assert.equal(run([], { TOOLING_CHANGED_FILES: join(root, 'changed.txt') }).status, 0);
  put(root, 'changed.txt', 'src/a.ts\n');
  assert.equal(run([], { TOOLING_CHANGED_FILES: join(root, 'changed.txt') }).status, 1);

  // --all: nothing to judge, so existing clones are reported but do not fail
  const all = run();
  assert.equal(all.status, 0);
  assert.match(all.stdout, /2 existing clone\(s\), reported only/);

  // scope "all": every clone fails
  put(root, 'tooling.config.json', {
    schemaVersion: 1,
    duplication: { paths: ['src'], scope: 'all' },
  });
  assert.equal(run().status, 1);
  assert.equal(run(['src/unrelated.ts']).status, 1);

  // no configured folder exists (monorepo with the default "src"): fail, never a silent pass
  put(root, 'tooling.config.json', { schemaVersion: 1, duplication: {} });
  rmSync(join(root, 'src'), { recursive: true });
  const missing = run(['frontend/src/a.ts']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /none of src exist; set duplication\.paths/);
});

test('ci profile hands the branch changes to the duplication check', () => {
  const root = gitRepo();
  put(root, '.gitignore', 'node_modules\n.tooling\n');
  put(root, 'tooling.config.json', {
    schemaVersion: 1,
    duplication: { paths: ['src'] },
    checks: Object.fromEntries(
      [
        'format',
        'lint',
        'styles',
        'types',
        'unit',
        'translations',
        'build',
        'size',
        'deadcode',
        'security',
        'e2e',
        'visual',
        'lighthouse',
        'workflows',
      ].map((id) => [id, false]),
    ),
  });
  put(root, 'src/old.ts', 'export const old = 1;\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'base');
  put(root, 'node_modules/jscpd/package.json', { bin: { jscpd: 'bin.cjs' } });
  put(root, 'node_modules/.bin/jscpd', '');
  put(root, 'node_modules/.bin/jscpd.cmd', '');
  // Fake jscpd: records the changed-file list it was given, reports one clone in src/new.ts.
  put(
    root,
    'node_modules/jscpd/bin.cjs',
    `const fs = require('fs'), path = require('path');
fs.writeFileSync('seen.txt', process.env.TOOLING_CHANGED_FILES ? fs.readFileSync(process.env.TOOLING_CHANGED_FILES, 'utf8') : 'none');
const out = process.argv[process.argv.indexOf('--output') + 1];
fs.writeFileSync(path.join(out, 'jscpd-report.json'), JSON.stringify({ duplicates: [{ firstFile: { name: 'src/new.ts', start: 1, end: 5 }, secondFile: { name: 'src/old.ts', start: 1, end: 5 }, lines: 5 }] }));`,
  );
  put(root, 'src/new.ts', 'export const copy = 1;\n');
  git(root, 'add', 'src/new.ts');
  git(root, 'commit', '-qm', 'copy');
  const cli = join(repo, 'packages/tooling/runner/cli.mjs');
  const result = spawnSync(
    process.execPath,
    [cli, '--profile=ci', '--changed', '--base=HEAD~1', '--committed', '--only=duplication'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.match(readFileSync(join(root, 'seen.txt'), 'utf8'), /src\/new\.ts/);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stdout + result.stderr, /src\/new\.ts:1-5 duplicates src\/old\.ts/);
});

test('duplication is opt-in', () => {
  assert.ok(!plan({ schemaVersion: 1, checks: {} }).checks.some((c) => c.id === 'duplication'));
  assert.ok(
    plan({ schemaVersion: 1, duplication: {}, checks: {} }).checks.some(
      (c) => c.id === 'duplication',
    ),
  );
});

test('vendored skills match their pinned upstream content', async () => {
  const { createHash } = await import('node:crypto');
  const manifest = JSON.parse(readFileSync(join(plugin, 'vendor.json'), 'utf8'));
  for (const [dir, entry] of Object.entries(manifest)) {
    const root = join(plugin, dir);
    const local = Object.fromEntries(
      files(root)
        .map((file) => relative(root, file).split(sep).join('/'))
        .filter((name) => name !== 'UPSTREAM.md')
        .map((name) => [
          name,
          createHash('sha256')
            .update(readFileSync(join(root, name), 'utf8').replace(/\r\n/g, '\n'))
            .digest('hex'),
        ]),
    );
    assert.deepEqual(
      local,
      entry.files,
      `${dir} differs from ${entry.repository}@${entry.commit}: copy upstream again and refresh claude/vendor.json, never edit it here`,
    );
  }
});
