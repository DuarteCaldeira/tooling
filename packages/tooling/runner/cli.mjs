#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { watchChanges } from './watch.mjs';
import { loadConfig } from './config.mjs';
import { changedFiles, clean, git, captureSnapshot } from './git.mjs';
import { checkCache } from './cache.mjs';
import { plan } from './graph.mjs';
import { execute, invoke } from './execute.mjs';
import { writeReport } from './report.mjs';
import { setupCommand } from './setup.mjs';
import { generateCommand } from './generate.mjs';
import { collectMetrics, historyText, performanceHistory } from './insights.mjs';
import { createHash } from 'node:crypto';

const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const args = process.argv.slice(2);
const subcommand = ['init', 'doctor', 'generate', 'history'].includes(args[0])
  ? args.shift()
  : undefined;
const generator = subcommand === 'generate' ? args.shift() : undefined;
const valueFlags =
  subcommand === 'generate'
    ? ['cwd', 'config', 'name', 'path']
    : subcommand === 'history'
      ? ['cwd', 'limit']
      : subcommand === 'init'
        ? ['cwd', 'preset', 'app', 'tooling-sha']
        : subcommand === 'doctor'
          ? ['cwd', 'config']
          : ['profile', 'base', 'head', 'config', 'only', 'skip', 'output', 'cwd', 'concurrency'];
const boolFlags =
  subcommand === 'generate'
    ? ['dry-run', 'design-system']
    : subcommand === 'doctor'
      ? ['repo-standard']
      : subcommand
        ? []
        : ['changed', 'all', 'bail', 'install', 'plan', 'watch', 'committed', 'no-cache'];
const options = {};
for (let i = 0; i < args.length; i++) {
  const [flag, ...tail] = args[i].replace(/^--/, '').split('=');
  if (!args[i].startsWith('--') || ![...valueFlags, ...boolFlags].includes(flag))
    throw new Error(`Unknown argument: ${args[i]}`);
  if (boolFlags.includes(flag)) {
    if (tail.length) throw new Error(`--${flag} takes no value`);
    options[flag] = true;
  } else {
    options[flag] = tail.length ? tail.join('=') : args[++i];
    if (!options[flag] || options[flag].startsWith('--'))
      throw new Error(`--${flag} needs a value`);
  }
}
if (options.all && options.changed) throw new Error('Choose --all or --changed');
if (options.watch && options.profile !== 'dev') throw new Error('--watch requires --profile=dev');
if (options.head && !options.committed) throw new Error('--head requires --committed');
const root = resolve(options.cwd ?? process.cwd());
const state = join(root, '.tooling', 'state');
const output = resolve(root, options.output ?? '.tooling/report');
const list = (key) => options[key]?.split(',').filter(Boolean) ?? [];
const profile = options.profile ?? 'ci';
if (
  options.concurrency !== undefined &&
  (!/^\d+$/.test(options.concurrency) ||
    Number(options.concurrency) < 1 ||
    Number(options.concurrency) > 16)
)
  throw new Error('--concurrency must be an integer between 1 and 16');

async function run() {
  const started = Date.now();
  const { config, raw } = loadConfig(root, options.config);
  let base = options.base ?? (profile === 'dev' ? 'HEAD' : undefined);
  if (!base) {
    try {
      base = git(root, 'rev-parse', 'origin/main');
    } catch {
      if (options.changed) throw new Error('No origin/main: pass --base=<revision> or --all');
      base = 'HEAD';
    }
  }
  base = git(root, 'rev-parse', `${base}^{commit}`);
  if (profile === 'push') {
    if (options.committed || options.head)
      throw new Error('Push validation must include the current worktree');
    let expectedBase;
    try {
      expectedBase = git(root, 'rev-parse', 'origin/main^{commit}');
    } catch {}
    if (!options.all && (!expectedBase || expectedBase !== base))
      throw new Error('Push validation must use current origin/main, or --all without a remote');
  }
  const files =
    !options.all && (options.changed || options.base)
      ? changedFiles(root, base, { committed: options.committed, head: options.head ?? 'HEAD' })
      : 'all';
  const selection = plan(config, { files, profile, only: list('only'), skip: list('skip') });
  if (options.plan) {
    console.log(JSON.stringify(selection, null, 2));
    return true;
  }
  if (!selection.checks.length && !selection.excluded.length) {
    console.log('No applicable checks; nothing to install or validate.');
    if (profile === 'push' && !clean(root)) {
      console.error('No pass recorded: commit all tracked and untracked files first.');
      return false;
    }
    return true;
  }
  if (options.install) {
    const result = await invoke(['npm', 'ci', '--ignore-scripts'], root);
    if (result.status !== 'passed') throw new Error('Dependency installation failed');
  }
  const context = {
    base,
    version,
    config: raw,
    environment: config.environment,
    inputs: [
      ...new Set([
        ...(config.inputs ?? []),
        ...(config.a11y?.storageState ? [config.a11y.storageState] : []),
        ...selection.checks
          .filter((c) => c.cwd)
          .map((c) => join(c.cwd, 'node_modules/.package-lock.json')),
      ]),
    ],
    tools: [
      ...new Map(
        selection.checks.flatMap((check) =>
          [...(check.tools ?? []), ...(Array.isArray(check.command) ? [check.command[0]] : [])].map(
            (name) => [`${check.cwd ?? '.'}\0${name}`, { name, cwd: check.cwd ?? '.' }],
          ),
        ),
      ).values(),
    ],
  };
  const captured = captureSnapshot(root, context);
  const before = captured.fingerprint;
  const cache = checkCache(root, config, selection, captured, {
    disabled: options['no-cache'] || options.all,
  });
  const passPath = join(state, 'push-pass.json');
  const checkKey = JSON.stringify(selection.checks.map((check) => check.id));
  let cached;
  try {
    cached = JSON.parse(readFileSync(passPath, 'utf8'));
  } catch {}
  if (
    profile === 'push' &&
    cache.reusablePass &&
    !options['no-cache'] &&
    clean(root) &&
    cached?.fingerprint === before &&
    cached?.base === base &&
    cached?.checks === checkKey &&
    !selection.excluded.length &&
    !list('only').length
  ) {
    console.log('Pass recorded: matching commit, base, tooling, configuration and inputs.');
    return true;
  }
  process.env.TOOLING_CONFIG_PATH = options.config ?? 'tooling.config.json';
  process.env.TOOLING_REPORT_DIR = output;
  process.env.TOOLING_COMMIT = git(root, 'rev-parse', 'HEAD');
  process.env.TOOLING_VERSION = version;
  const result = await execute(root, selection, {
    cache,
    toolCache: !options['no-cache'],
    bail: options.bail,
    concurrency:
      options.concurrency !== undefined
        ? Number(options.concurrency)
        : config.execution?.concurrency,
  });
  const after = captureSnapshot(root, context).fingerprint;
  if (before !== after) {
    result.complete = false;
    result.results.push({
      id: 'inputs',
      status: 'unavailable',
      reason: 'Inputs changed during validation',
    });
  } else cache.commit(result.results);
  const report = {
    schemaVersion: 1,
    version,
    profile,
    groups: selection.groups,
    affectedWorkspaces: selection.affectedWorkspaces,
    required: selection.required,
    commit: git(root, 'rev-parse', 'HEAD'),
    base,
    tree: git(root, 'rev-parse', 'HEAD^{tree}'),
    fingerprint: before,
    finishedAt: new Date().toISOString(),
    startedAt: new Date(started).toISOString(),
    wallMilliseconds: Date.now() - started,
    node: process.version,
    platform: process.platform,
    configuration: createHash('sha256').update(raw).digest('hex'),
    ...result,
  };
  report.metrics = collectMetrics(root, output, report, config.reporting);
  report.performance = performanceHistory(root, report, config.history);
  writeReport(output, report);
  for (const r of report.results)
    console.log(`${r.status.padEnd(11)} ${r.id}${r.reason ? `: ${r.reason}` : ''}`);
  console.log(`Report: ${join(output, 'index.html')}`);
  if (profile === 'push' && result.complete) {
    if (!clean(root)) {
      console.error('No pass recorded: commit all tracked and untracked files first.');
      return false;
    }
    mkdirSync(state, { recursive: true });
    writeFileSync(passPath, JSON.stringify({ fingerprint: before, base, checks: checkKey }));
    console.log('Pass recorded');
  }
  return result.complete;
}

try {
  if (subcommand === 'generate') process.exitCode = generateCommand(root, generator, options);
  else if (subcommand === 'history') {
    const limit = options.limit === undefined ? 20 : Number(options.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('--limit must be between 1 and 1000');
    console.log(historyText(root, limit));
  } else if (subcommand) process.exitCode = await setupCommand(subcommand, root, options);
  else if (!options.watch) process.exitCode = (await run()) ? 0 : 1;
  else {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      await watchChanges(root, run, {
        signal: controller.signal,
        inputs: () => loadConfig(root, options.config).config.inputs ?? [],
      });
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
