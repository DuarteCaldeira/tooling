#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { changedFiles } from '../../packages/tooling/runner/git.mjs';
import { plan } from '../../packages/tooling/runner/graph.mjs';
import { loadConfig } from '../../packages/tooling/runner/config.mjs';

const [directory, base = 'origin/main'] = process.argv.slice(2);
if (!directory) throw new Error('Usage: compare.mjs <Rookie-directory> [base]');
const root = resolve(directory);
const historical = execFileSync('git', ['show', `${base}:scripts/change-scope.mjs`], {
  cwd: root,
  encoding: 'utf8',
});
const { changeScope } = await import(
  `data:text/javascript;base64,${Buffer.from(historical).toString('base64')}`
);
const { config } = loadConfig(root);
const files = changedFiles(root, base);
console.log(
  JSON.stringify(
    { files, oldScope: changeScope(files), newPlan: plan(config, { files }) },
    null,
    2,
  ),
);
