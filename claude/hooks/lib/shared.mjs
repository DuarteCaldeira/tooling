import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export async function readInput() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

export function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Nearest ancestor of `start` (inclusive) that holds `name`. */
export function findUp(start, name) {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, name))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Resolve a package's bin script so it runs with `node` directly (no .cmd shims, no npx). */
export function packageBin(root, pkg, name = pkg) {
  const manifest = readJSON(join(root, 'node_modules', pkg, 'package.json'));
  if (!manifest?.bin) return undefined;
  const rel = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[name];
  if (!rel) return undefined;
  const path = join(root, 'node_modules', pkg, rel);
  return existsSync(path) ? path : undefined;
}

export function listDirs(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
}

export function emit(object) {
  process.stdout.write(JSON.stringify(object));
}
