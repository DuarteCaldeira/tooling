#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from './config.mjs';
import { changedFiles, clean, git, snapshot } from './git.mjs';
import { plan } from './graph.mjs';
import { execute, invoke } from './execute.mjs';
import { writeReport } from './report.mjs';

const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const args = process.argv.slice(2);
const valueFlags = ['profile', 'base', 'head', 'config', 'only', 'skip', 'output', 'cwd'];
const boolFlags = ['changed', 'all', 'bail', 'install', 'plan', 'watch', 'committed', 'no-cache'];
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
const state = resolve(root, git(root, 'rev-parse', '--git-path', 'repo-tooling'));
const output = resolve(options.output ?? join(state, 'report'));
const list = (key) => options[key]?.split(',').filter(Boolean) ?? [];
const profile = options.profile ?? 'ci';

async function run() {
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
  if (options.install) {
    const result = await invoke(['npm', 'ci', '--ignore-scripts'], root);
    if (result.status !== 'passed') throw new Error('Dependency installation failed');
  }
  const context = {
    base,
    version,
    config: raw,
    environment: config.environment,
    inputs: config.inputs,
    tools: [...new Set(selection.checks.flatMap((c) => c.tools ?? []))],
  };
  const before = snapshot(root, context);
  const passPath = join(state, 'push-pass.json');
  const checkKey = JSON.stringify(selection.checks.map((check) => check.id));
  let cached;
  try {
    cached = JSON.parse(readFileSync(passPath, 'utf8'));
  } catch {}
  if (
    profile === 'push' &&
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
  process.env.REPO_TOOLING_CONFIG_PATH = options.config ?? 'repo-tooling.config.json';
  process.env.REPO_TOOLING_REPORT_DIR = output;
  process.env.REPO_TOOLING_COMMIT = git(root, 'rev-parse', 'HEAD');
  process.env.REPO_TOOLING_VERSION = version;
  const result = await execute(root, selection, { bail: options.bail });
  const after = snapshot(root, context);
  if (before !== after) {
    result.complete = false;
    result.results.push({
      id: 'inputs',
      status: 'unavailable',
      reason: 'Inputs changed during validation',
    });
  }
  const report = {
    schemaVersion: 1,
    version,
    profile,
    groups: selection.groups,
    required: selection.required,
    commit: git(root, 'rev-parse', 'HEAD'),
    base,
    tree: git(root, 'rev-parse', 'HEAD^{tree}'),
    fingerprint: before,
    finishedAt: new Date().toISOString(),
    ...result,
  };
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
  if (!options.watch) process.exitCode = (await run()) ? 0 : 1;
  else {
    let previous;
    while (true) {
      const { raw, config } = loadConfig(root, options.config);
      const key = snapshot(root, {
        base: options.base ?? 'HEAD',
        version,
        config: raw,
        environment: config.environment,
        inputs: config.inputs,
      });
      if (previous !== key) {
        await delay(350);
        await run();
        previous = key;
      }
      await delay(500);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
