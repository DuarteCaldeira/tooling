#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { loadConfig, inside } from '../runner/config.mjs';
import { initSync, parse } from 'es-module-lexer';
import { writeDetails } from './shared.mjs';

initSync();

const jsFile = (file) => /\.[cm]?js$/.test(file);
const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
  );

// The module lexer handles minified ESM, escapes, comments, strings and re-exports.
export function staticImports(source) {
  const [imports] = parse(source);
  return imports.filter((item) => item.d === -1 && item.n).map((item) => item.n);
}

export function analyseBundle(root, budget) {
  const dist = inside(root, budget.dist);
  const chunks = walk(dist)
    .map((file) => relative(dist, file).replaceAll('\\', '/'))
    .filter(jsFile);
  const available = new Set(chunks);
  const resolveAsset = (url, importer = 'index.html') => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) return null;
    let path;
    try {
      path = decodeURIComponent(url.split(/[?#]/)[0]);
    } catch {
      throw new Error(`Invalid asset URL: ${url}`);
    }
    if (!jsFile(path)) return null;
    const local = posix.normalize(
      path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(importer), path),
    );
    if (available.has(local)) return local;
    // Match the build's real asset path after a deployment prefix such as /my-app/.
    if (path.startsWith('/')) {
      const matches = chunks.filter((file) => path.endsWith('/' + file));
      if (matches.length === 1) return matches[0];
    }
    throw new Error(`Missing local JavaScript asset: ${url} (from ${importer})`);
  };
  const html = readFileSync(join(dist, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const entries = new Set();
  for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const attrs = Object.fromEntries(
      [...tag[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map((m) => [
        m[1].toLowerCase(),
        m[2] ?? m[3] ?? m[4],
      ]),
    );
    if (tag[1].toLowerCase() === 'link' && attrs.rel?.toLowerCase() !== 'modulepreload') continue;
    const url = attrs.src ?? attrs.href;
    if (!url) continue;
    const asset = resolveAsset(url);
    if (asset) entries.add(asset);
  }
  if (!entries.size) throw new Error('No local initial JavaScript found in dist/index.html');
  const initial = new Set();
  const visit = (file) => {
    if (initial.has(file)) return;
    initial.add(file);
    for (const specifier of staticImports(readFileSync(join(dist, file), 'utf8'))) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
      const dependency = resolveAsset(specifier, file);
      if (dependency) visit(dependency);
    }
  };
  entries.forEach(visit);
  const gzip = (file) => gzipSync(readFileSync(join(dist, file))).length;
  const initialKB = [...initial].reduce((sum, file) => sum + gzip(file), 0) / 1024;
  const errors = [];
  if (initialKB > budget.initialKB)
    errors.push(`initial JS ${initialKB.toFixed(1)} KB > ${budget.initialKB} KB`);
  for (const file of chunks) {
    if (initial.has(file)) continue;
    let vendor;
    try {
      const map = JSON.parse(readFileSync(join(dist, `${file}.map`), 'utf8'));
      const weights = new Map();
      map.sources.forEach((source, i) => {
        const hit = (budget.vendors ?? []).find(([pkg]) =>
          source.replaceAll('\\', '/').includes(`node_modules/${pkg}/`),
        );
        if (hit) weights.set(hit, (weights.get(hit) ?? 0) + (map.sourcesContent?.[i]?.length ?? 0));
      });
      const total = (map.sourcesContent ?? []).reduce(
        (sum, content) => sum + (content?.length ?? 0),
        0,
      );
      const best = [...weights].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > total / 2) vendor = best[0];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const size = gzip(file) / 1024;
    // A file with no source map, such as a pre-built worker, gets its allowance by path.
    const allowed = vendor ?? (budget.files ?? []).find(([part]) => file.includes(part));
    const cap = allowed ? allowed[2] : budget.chunkKB;
    if (size > cap)
      errors.push(
        `${file} (${allowed ? allowed[1] : 'route chunk'}) ${size.toFixed(1)} KB > ${cap} KB`,
      );
  }
  return { initialKB, initial: [...initial], chunks: chunks.length, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.TOOLING_ROOT ?? process.cwd();
  const { config } = loadConfig(root);
  if (!config.budgets?.bundle) throw new Error('Configure budgets.bundle');
  const result = analyseBundle(root, config.budgets.bundle);
  writeDetails({ bundle: result });
  console.log(
    `initial JS: ${result.initialKB.toFixed(1)} KB gzip across ${result.initial.length} files; ${result.chunks} chunks checked`,
  );
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else console.log('Bundle budgets OK.');
}
