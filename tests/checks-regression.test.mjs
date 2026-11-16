import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { advisories, evaluateAudit, readAllowlist } from '../packages/tooling/checks/audit.mjs';
import { scanSecrets, secretLabels } from '../packages/tooling/checks/scan-secrets.mjs';
import { analyseArchitecture } from '../packages/tooling/checks/architecture.mjs';
import { analyseDependencies } from '../packages/tooling/checks/dependencies.mjs';
import { git } from '../packages/tooling/runner/git.mjs';
import { plan } from '../packages/tooling/runner/graph.mjs';

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'tooling-checks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(root, file, content) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}
const report = (severity = 'high') => ({
  vulnerabilities: {
    example: { via: [{ url: 'https://github.com/advisories/GHSA-example', name: 'example', severity }] },
  },
});

test('audit refuses API errors and malformed reports instead of recording a clean pass', () => {
  for (const value of [null, {}, { error: { code: 'E401' } }, { vulnerabilities: [] },
    { vulnerabilities: {}, error: { code: 'ENOAUDIT' } },
    { vulnerabilities: { example: { via: null } } }])
    assert.throws(() => advisories(value), /npm audit/);
  assert.deepEqual([...advisories({ vulnerabilities: {} })], []);
  assert.deepEqual([...advisories(report('moderate'))], []);
  assert.equal(advisories(report()).get('GHSA-example'), 'example');
});

test('audit rejects production findings, expired exceptions and missing development exceptions', () => {
  const clean = { vulnerabilities: {} };
  const allow = new Map([['GHSA-example', {
    id: 'GHSA-example', expires: '2026-11-16', reason: 'Test fixture',
  }]]);
  assert.equal(evaluateAudit(report(), report(), allow, '2026-11-16').problems.length, 1);
  assert.equal(evaluateAudit(clean, report(), new Map(), '2026-11-16').problems.length, 1);
  assert.equal(evaluateAudit(clean, report(), allow, '2026-11-17').problems.length, 1);
  assert.deepEqual(evaluateAudit(clean, report(), allow, '2026-11-16').problems, []);
});

test('audit allowlists are optional by default and reject invalid or duplicate exceptions', (t) => {
  const root = temporary(t);
  assert.equal(readAllowlist(root).size, 0);
  assert.throws(() => readAllowlist(root, 'required.json'), /ENOENT/);
  const valid = { id: 'GHSA-example', expires: '2026-12-01', reason: 'Temporary development dependency' };
  for (const advisories of [[{ ...valid, expires: '2026-02-30' }],
    [{ ...valid, expires: undefined }], [{ ...valid, reason: '' }], [valid, valid]]) {
    put(root, 'audit-allowlist.json', JSON.stringify({ advisories }));
    assert.throws(() => readAllowlist(root), /unique IDs/);
  }
  put(root, 'audit-allowlist.json', JSON.stringify({ advisories: [valid] }));
  assert.equal(readAllowlist(root).get(valid.id).reason, valid.reason);
});

function jwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [encode({ alg: 'HS256', typ: 'JWT' }), encode({ role }), 'fixture'].join('.');
}
test('secret scanning decodes service roles without leaking credentials in diagnostics', (t) => {
  const root = temporary(t);
  git(root, 'init');
  const token = jwt('service_role');
  assert.deepEqual(secretLabels(jwt('anon')), []);
  assert.deepEqual(secretLabels('eyJfixture.invalid.fixture'), []);
  assert.deepEqual(secretLabels(token), ['Supabase service-role JWT']);
  put(root, 'package-lock.json', JSON.stringify({ token }));
  put(root, 'tracked.txt', jwt('anon'));
  git(root, 'add', '--', 'tracked.txt');
  put(root, '.gitignore', 'ignored.txt\n');
  put(root, 'ignored.txt', token);
  put(root, 'binary.dat', '\0' + token);
  const result = scanSecrets(root);
  assert.deepEqual(result.hits, [{ file: 'package-lock.json', label: 'Supabase service-role JWT' }]);
  assert.ok(!JSON.stringify(result).includes(token));
});

test('secret scanning does not follow symlinks outside the repository', { skip: process.platform === 'win32' }, (t) => {
  const root = temporary(t), outside = temporary(t);
  git(root, 'init');
  put(outside, 'secret.txt', jwt('service_role'));
  symlinkSync(join(outside, 'secret.txt'), join(root, 'external.txt'));
  assert.deepEqual(scanSecrets(root).hits, []);
});

test('SCSS fix reports remaining violations and passes once all problems are resolved', (t) => {
  const root = temporary(t);
  put(root, 'tooling.config.json', JSON.stringify({ schemaVersion: 1, styles: { preset: 'rookie' } }));
  const file = 'src/style.scss';
  put(root, file, '.box {\n  width: 1px;\n  display: block;\n  color: red;\n}\n');
  const checker = fileURLToPath(new URL('../packages/tooling/checks/lint-scss.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [checker, '--fix'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, TOOLING_ROOT: root, TOOLING_CONFIG_PATH: 'tooling.config.json' },
  });
  const failed = run();
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /color-named/);
  assert.doesNotMatch(failed.stderr, /order\/properties-order/);
  assert.ok(readFileSync(join(root, file), 'utf8').indexOf('display:') <
    readFileSync(join(root, file), 'utf8').indexOf('width:'));
  put(root, file, '.box {\n  width: 1px;\n  display: block;\n}\n');
  const passed = run();
  assert.equal(passed.status, 0, passed.stderr);
});

test('module resolution caches stay local to each analysis and workspace', (t) => {
  const root = temporary(t);
  put(root, 'src/a.ts', "export {value} from './shared';");
  put(root, 'src/b.ts', "export {value} from './shared';");
  put(root, 'src/shared.ts', 'export const value = 1;');
  const caches = [];
  const compiler = { ...ts, resolveModuleName(...args) {
    caches.push(args[4]);
    return ts.resolveModuleName(...args);
  } };
  const files = ['src/a.ts', 'src/b.ts', 'src/shared.ts'];
  assert.deepEqual(analyseArchitecture(root, {}, files, compiler).issues, []);
  assert.ok(caches[0]);
  assert.equal(caches[0], caches[1]);
  const first = caches[0];
  put(root, 'src/shared.ts', "export {value} from './missing';");
  const changed = analyseArchitecture(root, {}, files, compiler);
  assert.ok(changed.issues.some((issue) => issue.rule === 'unresolved-import'));
  assert.notEqual(caches[2], first);
  put(root, 'package.json', JSON.stringify({ name: 'root' }));
  const manifests = ['package.json', 'apps/a/package.json', 'apps/b/package.json'];
  for (const name of ['a', 'b']) {
    put(root, `apps/${name}/package.json`, JSON.stringify({ name: `@app/${name}`, version: '1.0.0' }));
    put(root, `apps/${name}/src/index.ts`, "import './local';");
    put(root, `apps/${name}/src/local.ts`, 'export {};');
  }
  caches.length = 0;
  analyseDependencies(root, {}, manifests, { packages: {} },
    ['apps/a/src/index.ts', 'apps/b/src/index.ts'], compiler);
  assert.ok(caches[0]);
  assert.ok(caches[1]);
  assert.notEqual(caches[0], caches[1]);
});

test('shared dependency graphs select each prerequisite once and still detect cycles', () => {
  const checks = { step0: { command: ['node'], groups: ['app'], profiles: ['ci'] } };
  for (let i = 1; i <= 14; i++)
    for (const side of ['a', 'b'])
      checks[`step${i}${side}`] = {
        command: ['node'], groups: ['app'], profiles: ['ci'],
        dependsOn: i === 1 ? ['step0'] : [`step${i - 1}a`, `step${i - 1}b`],
      };
  const selection = plan({ checks }, { only: ['step14a', 'step14b'], files: ['src/app.ts'] });
  assert.equal(selection.checks.length, 29);
  assert.equal(new Set(selection.checks.map((check) => check.id)).size, 29);
  checks.step0.dependsOn = ['step14b'];
  assert.throws(() => plan({ checks }, { only: ['step14a'] }), /Cyclic checks/);
});
