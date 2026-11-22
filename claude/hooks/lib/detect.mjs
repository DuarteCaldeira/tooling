import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { listDirs, readJSON } from './shared.mjs';

// Keep in sync with `hasFrontend` in packages/tooling/runner/repo-standard.mjs (a test compares them).
const FALLBACK_GLOBS = ['apps', 'packages'];
const FRONTEND_DEPS = ['react', 'react-native', 'expo', 'vite', 'next'];

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
  for (const dir of listDirs(root)) dirs.add(dir);
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

const STACK_DEPS = { expo: 'expo', vite: 'vite', next: 'next', supabase: '@supabase/supabase-js' };
// Folder a Supabase project marks as backend → where its `supabase/` lives.
const SUPABASE_DIRS = { supabase: 'supabase', backend: 'backend/supabase' };

/**
 * Detect the stacks a repository uses, looking through workspace packages too.
 * `where` maps each stack (and `frontend`) to the repo-relative folders that use it; `.` is the root.
 * Returns `{ js: false }` for repositories without a root package.json.
 */
export function detectStack(root) {
  const manifest = readJSON(join(root, 'package.json'));
  if (!manifest) return { js: false, stacks: [] };
  const packages = [
    { dir: '.', deps: dependencies(manifest) },
    ...workspaceDirs(root, manifest).map((dir) => ({
      dir: relative(root, dir).split(sep).join('/'),
      deps: dependencies(readJSON(join(dir, 'package.json'))),
    })),
  ];
  const using = (names) =>
    packages.filter((p) => names.some((n) => p.deps.has(n))).map((p) => p.dir);
  const where = {};
  for (const [stack, dep] of Object.entries(STACK_DEPS)) {
    const dirs = using([dep]);
    if (stack === 'supabase')
      for (const [dir, path] of Object.entries(SUPABASE_DIRS))
        if (existsSync(join(root, path))) dirs.push(dir);
    if (dirs.length) where[stack] = [...new Set(dirs)];
  }
  const frontend = using(FRONTEND_DEPS);
  if (frontend.length) where.frontend = frontend;
  return {
    js: true,
    stacks: Object.keys(STACK_DEPS).filter((stack) => where[stack]),
    where,
    frontend: frontend.length > 0,
    tooling: existsSync(join(root, 'tooling.config.json')),
  };
}

/** `dashboard/, web/` for the folders a stack lives in, or '' when it covers the repo root. */
export function scopeLabel(dirs = []) {
  return dirs.includes('.') ? '' : dirs.map((dir) => `${dir}/`).join(', ');
}

export const SKILLS = {
  expo: 'core:expo-conventions',
  vite: 'core:react-conventions',
  next: 'core:react-conventions',
  supabase: 'core:backend-conventions',
};
