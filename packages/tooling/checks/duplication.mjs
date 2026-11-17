#!/usr/bin/env node
// Copy/paste detection with jscpd. Scans the configured paths; when given files (dev profile),
// fails only on clones that involve one of them, so existing duplication elsewhere does not
// block unrelated work.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../runner/config.mjs';

const FORMATS = 'typescript,tsx,javascript,jsx,scss,css';
const DEFAULT_IGNORE = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/__mocks__/**',
  '**/*.gen.*',
  '**/dist/**',
];

const posix = (path) => path.split('\\').join('/');

export function jscpdBin(repo) {
  try {
    const require = createRequire(join(repo, 'package.json'));
    const manifestPath = require.resolve('jscpd/package.json');
    const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const rel = typeof bin === 'string' ? bin : bin?.jscpd;
    return rel ? join(dirname(manifestPath), rel) : undefined;
  } catch {
    return undefined;
  }
}

/** Clones from a jscpd JSON report, optionally only those touching `changed` (repo-relative). */
export function relevantClones(report, repo, changed = []) {
  const wanted = new Set(changed.map(posix));
  const name = (file) => posix(relative(repo, resolve(repo, file.name)));
  return (report.duplicates ?? [])
    .map((clone) => ({
      first: {
        file: name(clone.firstFile),
        start: clone.firstFile.start,
        end: clone.firstFile.end,
      },
      second: {
        file: name(clone.secondFile),
        start: clone.secondFile.start,
        end: clone.secondFile.end,
      },
      lines: clone.lines,
    }))
    .filter(
      (clone) => !wanted.size || wanted.has(clone.first.file) || wanted.has(clone.second.file),
    );
}

function main() {
  const repo = process.env.TOOLING_ROOT ?? process.cwd();
  const { config } = loadConfig(repo);
  const options = config.duplication ?? {};
  const bin = jscpdBin(repo);
  if (!bin) {
    console.error('duplication: install jscpd as a devDependency');
    return 1;
  }
  // Changed files: dev passes them as arguments, push/ci through a list file. Neither (an `--all`
  // run) means there is no change to judge.
  const listed = process.env.TOOLING_CHANGED_FILES
    ? readFileSync(process.env.TOOLING_CHANGED_FILES, 'utf8').split(/\r?\n/).filter(Boolean)
    : undefined;
  const argFiles = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const given = argFiles.length ? argFiles : listed;
  const changed = (given ?? []).map((file) => posix(relative(repo, resolve(repo, file))));
  // scope "changed" (default): only clones touching a changed file fail; with no change list,
  // clones are reported without failing. scope "all": every clone fails (for repos with none).
  const scopeAll = options.scope === 'all';
  const reportOnly = !scopeAll && given === undefined;
  if (!scopeAll && given !== undefined && !changed.length) return 0;
  const configured = options.paths ?? ['src'];
  const paths = configured.filter((path) => existsSync(join(repo, path)));
  if (!paths.length) {
    console.error(`duplication: none of ${configured.join(', ')} exist; set duplication.paths`);
    return 1;
  }
  const output = mkdtempSync(join(tmpdir(), 'tooling-jscpd-'));
  try {
    const result = spawnSync(
      process.execPath,
      [
        bin,
        ...paths,
        '--min-tokens',
        String(options.minTokens ?? 70),
        '--format',
        FORMATS,
        '--ignore',
        [...DEFAULT_IGNORE, ...(options.ignore ?? [])].join(','),
        '--reporters',
        'json',
        '--output',
        output,
        '--silent',
        '--gitignore',
      ],
      { cwd: repo, encoding: 'utf8' },
    );
    const reportPath = join(output, 'jscpd-report.json');
    if (!existsSync(reportPath)) {
      console.error(result.stderr || result.stdout || 'duplication: jscpd produced no report');
      return 1;
    }
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const clones = relevantClones(report, repo, scopeAll ? [] : changed);
    for (const { first, second, lines } of clones)
      console.log(
        `${first.file}:${first.start}-${first.end} duplicates ${second.file}:${second.start}-${second.end} (${lines} lines). Move it to one shared module.`,
      );
    if (!clones.length) return 0;
    if (reportOnly) {
      console.log(
        `duplication: ${clones.length} existing clone(s), reported only (no changed files to judge; set duplication.scope "all" to fail on them)`,
      );
      return 0;
    }
    console.log(`duplication: ${clones.length} clone(s)`);
    return 1;
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main();
