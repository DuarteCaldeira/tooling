import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

import { buildHtml } from './visual-report-html.mjs';
import { inside } from '../runner/config.mjs';

const [baseRef, outDir = 'visual-diff', snapshotDir, resultsDir = 'test-results'] = process.argv.slice(2);

if (!baseRef || !snapshotDir || process.argv.length > 6) {
  process.stderr.write('Usage: visual-compare.mjs <baseRef> <outDir> <snapshotDir> [resultsDir]\n');
  process.exit(1);
}

const root = process.cwd();
const output = inside(root, outDir);
const snapshots = inside(root, snapshotDir);
const results = inside(root, resultsDir);
const overlaps = (a, b) => {
  const rel = relative(a, b).replaceAll(String.fromCharCode(92), '/');
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel));
};
if (output === root || overlaps(output, snapshots) || overlaps(snapshots, output) ||
    overlaps(output, results) || overlaps(results, output))
  throw new Error('Report output must be separate from source snapshots and test results');

const git = (...args) =>
  execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024 });

// Paths relative to the snapshot directory, e.g. `desktop/blocks-table--default--light.png`.
const listBase = () =>
  git('ls-tree', '-r', '--name-only', baseRef, '--', `./${snapshotDir}`)
    .toString()
    .split('\n')
    .map((file) => file.trim())
    .filter((file) => file.endsWith('.png'))
    .map((file) =>
      file.slice(file.indexOf(snapshotDir) + snapshotDir.length + 1)
    );

const listHead = (dir = '') => {
  const root = join(snapshotDir, dir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listHead(path);
    return entry.name.endsWith('.png') ? [path] : [];
  });
};

const baseFiles = new Set(listBase());
const headFiles = new Set(listHead());

const readBase = (file) => git('show', `${baseRef}:./${snapshotDir}/${file}`);
const readHead = (file) => readFileSync(join(snapshotDir, file));

const changes = [];

for (const file of [...new Set([...baseFiles, ...headFiles])].sort()) {
  const inBase = baseFiles.has(file);
  const inHead = headFiles.has(file);

  if (inBase && inHead) {
    if (!readBase(file).equals(readHead(file)))
      changes.push({ file, status: 'changed' });
  } else {
    changes.push({ file, status: inHead ? 'added' : 'removed' });
  }
}

// Failing tests leave `<test folder>-<project>/<name>-actual.png` next to the baseline they missed.
const listFailures = (dir = resultsDir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFailures(path);
    return entry.name.endsWith('-actual.png') ? [path] : [];
  });
};

const known = new Set(changes.map(({ file }) => file));
const projects = [...new Set([...headFiles].map((file) => file.split('/')[0]))]
  .sort((a, b) => b.length - a.length);

for (const actual of listFailures()) {
  const folder = basename(dirname(actual));
  const project = projects.find((name) => folder.endsWith('-' + name));
  if (!project) continue;
  const file = `${project}/${basename(actual).replace(/-actual\.png$/, '.png')}`;
  if (known.has(file) || !headFiles.has(file)) continue;
  changes.push({ file, status: 'changed', failure: actual });
}

rmSync(outDir, { recursive: true, force: true });

if (changes.length === 0) {
  process.stdout.write('No visual snapshot changes.\n');
  process.exit(0);
}

const counts = { added: 0, changed: 0, removed: 0 };
for (const { status } of changes) counts[status] += 1;

mkdirSync(outDir, { recursive: true });

// A failing test compares the committed baseline with the image the test produced.
const beforeOf = ({ file, status, failure }) => {
  if (failure) return readHead(file);
  return status === 'added' ? null : readBase(file);
};

const afterOf = ({ file, status, failure }) => {
  if (failure) return readFileSync(failure);
  return status === 'removed' ? null : readHead(file);
};

const entries = changes.map((change) => ({
  file: change.file,
  status: change.status,
  failure: Boolean(change.failure),
  before: beforeOf(change),
  after: afterOf(change),
}));
writeFileSync(
  join(outDir, 'index.html'),
  buildHtml({ entries, counts, baseRef })
);

const summary = `${counts.added} new (no previous snapshot), ${counts.changed} changed, ${counts.removed} removed.`;

// Short PR comment: counts only. Images live in the interactive report, not in the comment.
writeFileSync(
  join(outDir, 'comment.md'),
  ['<!-- visual-snapshots -->', '## Visual snapshots', '', summary, ''].join(
    '\n'
  )
);

process.stdout.write(
  `${counts.added} new, ${counts.changed} changed, ${counts.removed} removed. Report: ${join(outDir, 'index.html')}\n`
);
