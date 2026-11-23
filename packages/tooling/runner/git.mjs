import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { executable } from './execute.mjs';
import { detectPackageManager, installedLockfile } from './package-manager.mjs';

export const git = (root, ...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
const nul = (value) => value.split('\0').filter(Boolean);

export function changedFiles(root, base, { committed = false, head = 'HEAD' } = {}) {
  const ancestor = git(root, 'merge-base', base, head);
  const changes = nul(git(root, 'diff', '--name-only', '--no-renames', '-z', ancestor, head));
  if (!committed)
    changes.push(
      ...nul(git(root, 'diff', '--name-only', '--no-renames', '-z', 'HEAD')),
      ...nul(git(root, 'ls-files', '--others', '--exclude-standard', '-z')),
    );
  return [...new Set(changes)].sort();
}

export function toolIdentity(root, tool) {
  const name = typeof tool === 'string' ? tool : tool.name;
  const cwd = typeof tool === 'string' ? root : resolve(root, tool.cwd ?? '.');
  const command = executable(cwd, name);
  if (!command) return { name, cwd, command: null };
  if (name === 'node') return { name, cwd, command, version: process.version };
  if (command[0] === process.execPath && command[1]) {
    for (let directory = dirname(command[1]); ; directory = dirname(directory)) {
      try {
        const manifest = readFileSync(join(directory, 'package.json'), 'utf8');
        const entry = createHash('sha256').update(readFileSync(command[1])).digest('hex');
        return { name, cwd, command, manifest, entry };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (dirname(directory) === directory) break;
    }
  }
  let version;
  try {
    version = execFileSync(command[0], [...command.slice(1), '--version'], {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    version = 'version-unavailable';
  }
  return { name, cwd, command, version };
}

export function captureSnapshot(
  root,
  { base, version, config, environment = [], tools = [], inputs = [] },
) {
  const hash = createHash('sha256');
  const add = (value) => {
    const text = String(value);
    hash.update(`${Buffer.byteLength(text)}:`);
    hash.update(text);
  };
  add(version);
  add(process.version);
  add(process.platform);
  add(config);
  for (const file of [installedLockfile(detectPackageManager(root)), ...inputs]) {
    add(file);
    try {
      const bytes = readFileSync(resolve(root, file));
      add(bytes.length);
      hash.update(bytes);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      add('absent');
    }
  }
  for (const key of environment) {
    add(key);
    add(process.env[key] ?? '');
  }
  const context = hash.copy().digest('hex');
  const identities = tools.map((tool) => toolIdentity(root, tool));
  for (const identity of identities) add(JSON.stringify(identity));
  add(git(root, 'rev-parse', 'HEAD'));
  add(git(root, 'rev-parse', `${base}^{commit}`));
  const files = new Set(
    nul(git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')),
  );
  // Files git reports as unchanged are identified by their stored blob; only the rest are read.
  const stored = new Map();
  const changed = new Set([
    ...nul(git(root, 'ls-files', '--modified', '-z')),
    ...nul(git(root, 'ls-files', '--deleted', '-z')),
  ]);
  for (const entry of nul(git(root, 'ls-files', '--stage', '-z'))) {
    const [meta, path] = entry.split('\t');
    const [mode, blob, stage] = meta.split(' ');
    if (stage !== '0') changed.add(path);
    stored.set(path, `${mode} ${blob}`);
  }
  const digests = {};
  for (const file of [...files].sort()) {
    const content = createHash('sha256');
    const part = (value) => content.update(JSON.stringify(value));
    if (stored.has(file) && !changed.has(file)) {
      part(`stored ${stored.get(file)}`);
      digests[file] = content.digest('hex');
      add(file);
      add(digests[file]);
      continue;
    }
    try {
      const stat = lstatSync(resolve(root, file));
      part(stat.mode & 0o111);
      if (stat.isSymbolicLink()) part(readlinkSync(resolve(root, file)));
      else if (stat.isFile()) {
        const bytes = readFileSync(resolve(root, file));
        part(bytes.length);
        content.update(bytes);
      } else part('directory');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      part('deleted');
    }
    digests[file] = content.digest('hex');
    add(file);
    add(digests[file]);
  }
  return { fingerprint: hash.digest('hex'), context, files: digests, tools: identities };
}

export const snapshot = (root, context) => captureSnapshot(root, context).fingerprint;

export const clean = (root) => !git(root, 'status', '--porcelain', '--untracked-files=all');
