import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { executable } from './execute.mjs';

export const git = (root, ...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trimEnd();
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

export function snapshot(
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
  for (const file of ['node_modules/.package-lock.json', ...inputs]) {
    add(file);
    try {
      hash.update(readFileSync(resolve(root, file)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      add('absent');
    }
  }
  for (const tool of tools) {
    const command = executable(root, tool);
    add(tool);
    add(JSON.stringify(command));
    if (command) {
      try {
        add(
          execFileSync(command[0], [...command.slice(1), '--version'], {
            cwd: root,
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'pipe'],
          }),
        );
      } catch {
        add('version-unavailable');
      }
    }
  }
  add(git(root, 'rev-parse', 'HEAD'));
  add(git(root, 'rev-parse', `${base}^{commit}`));
  for (const key of environment) {
    add(key);
    add(process.env[key] ?? '');
  }
  const files = new Set(
    nul(git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')),
  );
  for (const file of [...files].sort()) {
    add(file);
    try {
      const stat = lstatSync(resolve(root, file));
      add(stat.mode & 0o111);
      if (stat.isSymbolicLink()) add(readlinkSync(resolve(root, file)));
      else if (stat.isFile()) {
        const bytes = readFileSync(resolve(root, file));
        add(bytes.length);
        hash.update(bytes);
      } else add('directory');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      add('deleted');
    }
  }
  return hash.digest('hex');
}

export const clean = (root) => !git(root, 'status', '--porcelain', '--untracked-files=all');
