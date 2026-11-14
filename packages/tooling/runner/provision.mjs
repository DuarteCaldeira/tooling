#!/usr/bin/env node
import { chmodSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { invoke } from './execute.mjs';

const selection = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const ids = selection.checks.filter((c) => !c.excluded).map((c) => c.id);
const tools = new Set(selection.checks.flatMap((c) => c.tools ?? []));
const root = process.cwd();
const bin = resolve('.repo-tooling/bin');
mkdirSync(bin, { recursive: true });
async function requirePass(command) {
  const result = await invoke(command, root);
  if (result.status !== 'passed')
    throw new Error(`Prerequisite installation failed: ${command.join(' ')}`);
}
if (process.platform !== 'linux')
  throw new Error('CI prerequisite provisioning requires Linux; use WSL or a container');
if (ids.includes('database')) {
  await requirePass(['sudo', 'apt-get', 'update']);
  await requirePass(['sudo', 'apt-get', 'install', '-y', 'postgresql-16', 'postgresql-16-pgtap']);
  if (process.env.GITHUB_ENV)
    appendFileSync(process.env.GITHUB_ENV, 'PG_BIN=/usr/lib/postgresql/16/bin\n');
}
for (const [name, image] of [
  ['actionlint', 'rhysd/actionlint:1.7.7'],
  ['gitleaks', 'zricethezav/gitleaks:v8.24.3'],
  ['deno', 'denoland/deno:2.5.6'],
]) {
  if (!tools.has(name)) continue;
  await requirePass(['docker', 'pull', image]);
  const path = join(bin, name);
  writeFileSync(path, `#!/bin/sh\nexec docker run --rm -v "$PWD:/repo" -w /repo ${image} "$@"\n`);
  chmodSync(path, 0o755);
}
if (tools.has('lhci')) {
  await requirePass([
    'npm',
    'install',
    '--prefix',
    '.repo-tooling/tools',
    '--no-save',
    '@lhci/cli@0.15.1',
  ]);
  const path = join(bin, 'lhci');
  writeFileSync(
    path,
    `#!/bin/sh\nexec node "${resolve('.repo-tooling/tools/node_modules/@lhci/cli/src/cli.js')}" "$@"\n`,
  );
  chmodSync(path, 0o755);
}
if (process.env.GITHUB_PATH) appendFileSync(process.env.GITHUB_PATH, `${bin}\n`);
