import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseDocument } from 'yaml';
import { advisories, evaluateAudit } from '../packages/tooling/checks/audit.mjs';
import { checkPackage } from '../packages/tooling/checks/package.mjs';
import { execute } from '../packages/tooling/runner/execute.mjs';
import { plan } from '../packages/tooling/runner/graph.mjs';
import { formatterLock } from '../packages/tooling/runner/docs-install.mjs';
import { planMetadata } from '../packages/tooling/runner/ci-plan.mjs';
import {
  adaptCommand,
  detectPackageManager,
  installCommand,
  installedLockfile,
  pnpmLockPackages,
  readLockfile,
} from '../packages/tooling/runner/package-manager.mjs';
import { diagnose, initialize, starterConfig } from '../packages/tooling/runner/setup.mjs';

const directories = [];
test.after(() => directories.forEach((d) => rmSync(d, { recursive: true, force: true })));
function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'tooling-pm-'));
  directories.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const pnpmProject = (extra = {}) =>
  project({
    'package.json': '{"name":"x","scripts":{"build":"vite build"}}',
    'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    ...extra,
  });

const pnpmLock = `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      left-pad:
        specifier: 1.3.0
        version: 1.3.0

packages:

  '@playwright/test@1.49.0':
    resolution: {integrity: sha512-a}
    hasBin: true

  left-pad@1.3.0:
    resolution: {integrity: sha512-b}

  left-pad@1.2.0:
    resolution: {integrity: sha512-c}

  playwright@1.49.0:
    resolution: {integrity: sha512-d}

snapshots:

  left-pad@1.3.0: {}
`;

test('package manager comes from packageManager, then the lockfile, and defaults to npm', () => {
  assert.equal(detectPackageManager(project({ 'package.json': '{}' })), 'npm');
  assert.equal(detectPackageManager(project({})), 'npm');
  assert.equal(detectPackageManager(project({ 'package-lock.json': '{}' })), 'npm');
  assert.equal(detectPackageManager(pnpmProject()), 'pnpm');
  assert.equal(
    detectPackageManager(project({ 'package.json': '{"packageManager":"pnpm@9.15.0"}' })),
    'pnpm',
  );
  assert.equal(
    detectPackageManager(
      project({ 'package.json': '{"packageManager":"npm@11.0.0"}', 'pnpm-lock.yaml': '' }),
    ),
    'npm',
  );
  assert.equal(
    detectPackageManager(project({ 'package.json': '{"packageManager":"yarn@4.0.0"}' })),
    'npm',
  );
});

test('npm keeps its commands and pnpm gets the frozen-lockfile equivalents', () => {
  assert.deepEqual(installCommand('npm'), ['npm', 'ci', '--ignore-scripts']);
  assert.deepEqual(installCommand('pnpm'), [
    'pnpm',
    'install',
    '--frozen-lockfile',
    '--ignore-scripts',
  ]);
  assert.equal(installedLockfile('npm'), 'node_modules/.package-lock.json');
  assert.equal(installedLockfile('pnpm'), 'node_modules/.pnpm/lock.yaml');
  const build = ['npm', 'run', 'build'];
  assert.equal(adaptCommand(build, 'npm'), build);
  assert.deepEqual(adaptCommand(build, 'pnpm'), ['pnpm', 'run', 'build']);
  assert.deepEqual(adaptCommand(['vitest', 'run'], 'pnpm'), ['vitest', 'run']);
  assert.equal(
    adaptCommand('npm audit --audit-level=high && gitleaks git --redact', 'pnpm'),
    'pnpm audit --audit-level=high && gitleaks git --redact',
  );
  assert.equal(adaptCommand('gitleaks git && npm audit', 'pnpm'), 'gitleaks git && pnpm audit');
});

test('lockfile versions are read from either lockfile in the npm shape', () => {
  const npm = project({
    'package-lock.json': JSON.stringify({ packages: { 'node_modules/a': { version: '1.0.0' } } }),
  });
  assert.equal(readLockfile(npm).packages['node_modules/a'].version, '1.0.0');
  assert.equal(readLockfile(project({})), undefined);
  const lock = pnpmLockPackages(pnpmLock);
  const versions = Object.entries(lock.packages).map(([path, e]) => [
    path.split('/node_modules/')[1],
    e.version,
  ]);
  assert.deepEqual(versions.sort(), [
    ['@playwright/test', '1.49.0'],
    ['left-pad', '1.2.0'],
    ['left-pad', '1.3.0'],
    ['playwright', '1.49.0'],
  ]);
  const root = pnpmProject({ 'pnpm-lock.yaml': pnpmLock });
  const metadata = planMetadata(root, { checks: [], excluded: [] }, {}, readLockfile(root));
  const without = planMetadata(root, { checks: [], excluded: [] }, {}, {});
  assert.notEqual(metadata['browser-key'], without['browser-key']);
});

test('pnpm audit reports are evaluated with the same allowlist rules', () => {
  const report = (severity, id = 'GHSA-pnpm') => ({
    advisories: {
      1: {
        module_name: 'left-pad',
        severity,
        github_advisory_id: id,
        url: `https://github.com/advisories/${id}`,
      },
    },
    metadata: {},
  });
  assert.equal(advisories(report('high')).get('GHSA-pnpm'), 'left-pad');
  assert.deepEqual([...advisories(report('moderate'))], []);
  assert.deepEqual([...advisories({ advisories: {} })], []);
  assert.equal(
    advisories({
      advisories: {
        1: {
          module_name: 'x',
          severity: 'critical',
          url: 'https://github.com/advisories/GHSA-url',
        },
      },
    }).get('GHSA-url'),
    'x',
  );
  assert.throws(() => advisories({ advisories: { 1: null } }), /malformed/);
  assert.throws(
    () => advisories({ error: { code: 'ERR_PNPM_AUDIT' }, advisories: {} }),
    /npm audit/,
  );
  const allow = new Map([['GHSA-pnpm', { expires: '2999-01-01', reason: 'dev only' }]]);
  const result = evaluateAudit(report('low'), report('high'), allow, '2026-01-01');
  assert.deepEqual(result.problems, []);
  assert.equal(result.notices.length, 1);
  assert.equal(evaluateAudit(report('high'), report('high'), allow).problems.length, 1);
});

test('execute runs npm adapters and the security check through pnpm only in pnpm repositories', async () => {
  const seen = async (root) => {
    const commands = [];
    const run = async (command) => {
      commands.push(typeof command === 'string' ? command : command.join(' '));
      return { status: 'passed' };
    };
    const selection = plan({}, { profile: 'ci', only: ['build', 'size', 'security'] });
    // Host tools (gitleaks) must not decide whether a check reaches `run`.
    selection.checks = selection.checks.map(({ tools, ...check }) => check);
    await execute(root, selection, { run, cache: undefined });
    return commands;
  };
  const npm = await seen(project({ 'package.json': '{}' }));
  assert.ok(npm.includes('npm run build'));
  assert.ok(npm.includes('npm audit --audit-level=high && gitleaks git --redact'));
  const pnpm = await seen(pnpmProject());
  assert.ok(pnpm.includes('pnpm run build'));
  assert.ok(pnpm.includes('pnpm run size'));
  assert.ok(pnpm.includes('pnpm audit --audit-level=high && gitleaks git --redact'));
  assert.ok(!pnpm.some((c) => c.startsWith('npm')));
});

test('package smoke check packs with the repository package manager', async () => {
  for (const [root, expected] of [
    [project({ 'entry.mjs': '', 'package.json': '{}' }), 'npm'],
    [pnpmProject({ 'entry.mjs': '' }), 'pnpm'],
  ]) {
    let first;
    await checkPackage(root, ['entry.mjs'], async (command) => {
      first = command[0];
      writeFileSync(join(command.at(-1), 'x-1.0.0.tgz'), '');
      return { status: 'passed' };
    });
    assert.equal(first, expected);
  }
});

test('init and doctor follow the detected package manager', () => {
  assert.deepEqual(
    starterConfig({ scripts: { lint: 'eslint .' }, packageManager: 'pnpm' }).checks.lint.command,
    ['pnpm', 'run', 'lint'],
  );
  assert.deepEqual(starterConfig({ scripts: { lint: 'eslint .' } }).checks.lint.command, [
    'npm',
    'run',
    'lint',
  ]);
  const root = pnpmProject({
    'package.json': JSON.stringify({
      name: 'x',
      scripts: { build: 'vite build', lint: 'eslint .' },
    }),
  });
  initialize(root);
  assert.match(readFileSync(join(root, '.githooks/pre-push'), 'utf8'), /exec pnpm run check:push/);
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, 'tooling.config.json'), 'utf8')).checks.build.command,
    ['pnpm', 'run', 'build'],
  );
  const messages = diagnose(root).map((f) => f.message);
  assert.ok(!messages.some((m) => m.includes('pnpm-lock.yaml')));
  assert.ok(!messages.some((m) => /missing .*script/.test(m)));
  const npmRoot = project({ 'package.json': '{}' });
  initialize(npmRoot);
  assert.ok(
    diagnose(npmRoot).some((f) =>
      f.message.includes('Run npm install and commit package-lock.json'),
    ),
  );
  const pnpmNoLock = project({ 'package.json': '{"packageManager":"pnpm@9.15.0"}' });
  initialize(pnpmNoLock);
  assert.ok(
    diagnose(pnpmNoLock).some((f) =>
      f.message.includes('Run pnpm install and commit pnpm-lock.yaml'),
    ),
  );
});

test('the standalone formatter install is limited to npm lockfiles', () => {
  const selection = plan({}, { files: ['README.md'] });
  assert.equal(formatterLock(pnpmProject(), selection), null);
  assert.equal(formatterLock(project({ 'package.json': '{}' }), selection), null);
});

test('reusable workflows install pnpm and use its frozen lockfile when pnpm-lock.yaml exists', () => {
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/release-validation.yml']) {
    const text = readFileSync(file, 'utf8');
    const job = Object.values(parseDocument(text).toJS().jobs).find((j) =>
      j.steps?.some((s) => s.uses?.startsWith('actions/setup-node')),
    );
    const steps = job.steps;
    const pnpmIndex = steps.findIndex((s) => s.uses?.startsWith('pnpm/action-setup@v'));
    const nodeIndex = steps.findIndex((s) => s.uses?.startsWith('actions/setup-node'));
    assert.ok(
      pnpmIndex >= 0 && pnpmIndex < nodeIndex,
      `${file}: pnpm is set up before Node caching`,
    );
    assert.match(steps[pnpmIndex].if, /pnpm-lock\.yaml/);
    assert.match(steps[nodeIndex].with.cache, /pnpm-lock\.yaml/);
    assert.match(text, /pnpm install --frozen-lockfile --ignore-scripts/);
    assert.match(text, /npm ci --ignore-scripts/);
    assert.match(text, /hashFiles\('\.nvmrc', 'package-lock\.json', 'pnpm-lock\.yaml'\)/);
  }
});
