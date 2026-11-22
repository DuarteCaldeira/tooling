import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Package manager of a repository: the `packageManager` field of the root package.json wins,
 * then a lockfile (pnpm-lock.yaml), then npm, which stays the default.
 * @param {string} root
 * @returns {'npm' | 'pnpm'}
 */
export function detectPackageManager(root) {
  try {
    const field = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager;
    const name = typeof field === 'string' ? field.split('@')[0] : '';
    if (name === 'npm' || name === 'pnpm') return name;
  } catch {
    // No readable manifest: fall through to the lockfile.
  }
  return existsSync(join(root, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
}

export const lockfileName = (pm) => (pm === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json');

/** Metadata file the package manager leaves in node_modules; it changes whenever installs do. */
export const installedLockfile = (pm) =>
  pm === 'pnpm' ? 'node_modules/.pnpm/lock.yaml' : 'node_modules/.package-lock.json';

export const installCommand = (pm) =>
  pm === 'pnpm'
    ? ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts']
    : ['npm', 'ci', '--ignore-scripts'];

export const scriptCommand = (pm, script) => [pm, 'run', script];

/**
 * Rewrites npm invocations (`npm run x`, `npm audit …`, `npm pack`) for a pnpm repository.
 * Other commands, and everything in an npm repository, pass through unchanged.
 */
export function adaptCommand(command, pm) {
  if (pm !== 'pnpm') return command;
  if (Array.isArray(command)) return command[0] === 'npm' ? ['pnpm', ...command.slice(1)] : command;
  return command.replace(/(^|&&\s*)npm\b/g, '$1pnpm');
}

/**
 * Reads the lockfile as an npm-shaped `{ packages }` object so version lookups (Playwright,
 * duplicate versions) work for both package managers. Returns undefined without a lockfile.
 */
export function readLockfile(root, pm = detectPackageManager(root)) {
  try {
    const text = readFileSync(join(root, lockfileName(pm)), 'utf8');
    return pm === 'pnpm' ? pnpmLockPackages(text) : JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Parses the `packages:` keys of pnpm-lock.yaml (v6 and v9) without a YAML dependency. */
export function pnpmLockPackages(text) {
  const packages = {};
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) inPackages = line.startsWith('packages:');
    else if (inPackages) {
      const match = line.match(/^ {2}'?\/?((?:@[^/@]+\/)?[^/@'\s]+)@(\d[^'(:\s]*)[^:]*'?:\s*$/);
      if (match)
        packages[`node_modules/.pnpm/${match[1]}@${match[2]}/node_modules/${match[1]}`] = {
          version: match[2],
        };
    }
  }
  return { lockfileVersion: 'pnpm', packages };
}
