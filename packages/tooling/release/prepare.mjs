#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { loadConfig } from '../runner/config.mjs';
import { git, clean } from '../runner/git.mjs';
import { invoke } from '../runner/execute.mjs';

const root = process.cwd();
const { config } = loadConfig(root);
if (!clean(root)) throw new Error('Commit all files before preparing a release');
if (!config.release?.prepare) throw new Error('Configure release.prepare');
const source = git(root, 'rev-parse', 'HEAD');
const level = process.argv[2] ?? process.env.RELEASE_LEVEL;
if (process.argv.length > 3 || !['major', 'minor', 'patch'].includes(level))
  throw new Error('Usage: prepare.mjs <patch|minor|major> or set RELEASE_LEVEL');
mkdirSync('.tooling', { recursive: true });
const result = await invoke(config.release.prepare, root, { extra: [level] });
if (result.status !== 'passed') throw new Error('Release preparation failed');
git(root, 'add', '--', ...config.release.files);
git(root, 'commit', '-m', `Release ${JSON.parse(readFileSync('package.json', 'utf8')).version}`);
if (!clean(root)) throw new Error('Release preparation modified files outside release.files');
const candidate = {
  source,
  head: git(root, 'rev-parse', 'HEAD'),
  tree: git(root, 'rev-parse', 'HEAD^{tree}'),
};
writeFileSync('.tooling/candidate.json', JSON.stringify(candidate));
if (process.env.GITHUB_OUTPUT)
  writeFileSync(process.env.GITHUB_OUTPUT, `head=${candidate.head}\nsource=${source}\n`, {
    flag: 'a',
  });
