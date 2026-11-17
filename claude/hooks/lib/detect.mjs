import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listDirs, readJSON } from './shared.mjs';

const FALLBACK_DIRS = ['frontend', 'backend', 'shared', 'app', 'web', 'mobile'];
const FALLBACK_GLOBS = ['apps', 'packages'];

function workspaceDirs(root, manifest) {
  const patterns = Array.isArray(manifest?.workspaces)
    ? manifest.workspaces
    : (manifest?.workspaces?.packages ?? []);
  const dirs = new Set();
  for (const pattern of patterns) {
    if (pattern.endsWith('/*'))
      for (const dir of listDirs(join(root, pattern.slice(0, -2)))) dirs.add(dir);
    else dirs.add(join(root, pattern));
  }
  for (const name of FALLBACK_DIRS) dirs.add(join(root, name));
  for (const name of FALLBACK_GLOBS) for (const dir of listDirs(join(root, name))) dirs.add(dir);
  return [...dirs].filter((dir) => existsSync(join(dir, 'package.json')));
}

function dependencies(manifest) {
  return new Set(
    Object.keys({
      ...manifest?.dependencies,
      ...manifest?.devDependencies,
      ...manifest?.peerDependencies,
    }),
  );
}

/**
 * Detect the stacks a repository uses, looking through workspace packages too.
 * Returns `{ js: false }` for repositories without a root package.json.
 */
export function detectStack(root) {
  const manifest = readJSON(join(root, 'package.json'));
  if (!manifest) return { js: false, stacks: [] };
  const manifests = [
    manifest,
    ...workspaceDirs(root, manifest).map((dir) => readJSON(join(dir, 'package.json'))),
  ];
  const deps = new Set(manifests.flatMap((m) => [...dependencies(m)]));
  const stacks = [];
  if (deps.has('expo')) stacks.push('expo');
  if (deps.has('vite')) stacks.push('vite');
  if (deps.has('next')) stacks.push('next');
  if (
    deps.has('@supabase/supabase-js') ||
    existsSync(join(root, 'supabase')) ||
    existsSync(join(root, 'backend', 'supabase'))
  )
    stacks.push('supabase');
  return {
    js: true,
    stacks,
    tooling: existsSync(join(root, 'tooling.config.json')),
  };
}

export const SKILLS = {
  expo: 'core:expo-conventions',
  vite: 'core:react-conventions',
  next: 'core:react-conventions',
  supabase: 'core:backend-conventions',
};
