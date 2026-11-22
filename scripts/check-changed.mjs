// `npm run check`: run only the unit tests for the areas the working tree changed.
// The Stop hook of the core plugin runs this after every turn with edits, so it must stay fast.
// Anything it cannot map (the runner, root config, an unknown path) runs the whole suite,
// and so does a clean tree or `--all`. CI runs `npm test`, the whole suite, regardless.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Path prefix → test files (in `tests/`, without `.test.mjs`). First match wins. */
export const AREAS = [
  [
    'packages/tooling/checks/',
    ['checks-regression', 'sass', 'translations', 'shared-scripts', 'features', 'optimizations'],
  ],
  ['packages/tooling/release/', ['release', 'github-release']],
  ['packages/tooling/templates/', ['workflows']],
  ['.github/workflows/', ['workflows']],
  ['claude/', ['claude-plugin']],
  ['.claude-plugin/', ['claude-plugin']],
  [
    'dashboard/',
    [
      'dashboard',
      'dashboard-runtime',
      'dashboard-vercel',
      'dashboard-overlay',
      'discussions',
      'release-notes',
    ],
  ],
];

// Eval outputs: generated, never read by a test. Checked before AREAS (they sit under claude/).
const OUTPUTS = /^claude\/evals\/results\//;
// Outside the areas, files no unit test reads. Markdown inside an area (skills, core rules) is tested.
const NO_TESTS = [/\.md$/, /^docs\//, /^LICENSE$/];

/**
 * Test files for a set of changed repo-relative paths: `undefined` means the whole suite,
 * an empty array means nothing to run.
 */
export function testsFor(files) {
  if (!files.length) return undefined;
  const tests = new Set();
  for (const file of files) {
    if (OUTPUTS.test(file)) continue;
    const own = /^tests\/([^/]+)\.test\.mjs$/.exec(file);
    if (own) {
      tests.add(own[1]);
      continue;
    }
    const area = AREAS.find(([prefix]) => file.startsWith(prefix));
    if (area) area[1].forEach((name) => tests.add(name));
    else if (!NO_TESTS.some((pattern) => pattern.test(file))) return undefined;
  }
  return [...tests].sort();
}

function changedFiles(root) {
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
    return result.stdout.split('\0').filter(Boolean);
  };
  return [
    ...new Set([
      ...git('diff', '--name-only', '-z', 'HEAD'),
      ...git('ls-files', '--others', '--exclude-standard', '-z'),
    ]),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const root = join(import.meta.dirname, '..');
  const all = readdirSync(join(root, 'tests'))
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => `tests/${name}`);
  const picked = process.argv.includes('--all') ? undefined : testsFor(changedFiles(root));
  const files = picked
    ? picked.map((name) => `tests/${name}.test.mjs`).filter((path) => existsSync(join(root, path)))
    : all;
  if (picked && !files.length) {
    console.log('check: no unit tests cover the changed files.');
    process.exit(0);
  }
  console.log(picked ? `check: ${files.join(' ')}` : 'check: whole suite');
  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
