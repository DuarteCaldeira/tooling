#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { loadConfig, inside } from '../runner/config.mjs';

const { config } = loadConfig(process.cwd());
const budget = config.budgets?.bundle;
if (!budget) throw new Error('Configure budgets.bundle');
const dist = inside(process.cwd(), budget.dist);
const KB = 1024;
const gz = (file) => gzipSync(readFileSync(join(dist, file))).length;

const VENDORS = budget.vendors ?? [];

const vendorOf = (file) => {
  try {
    const map = JSON.parse(readFileSync(join(dist, `${file}.map`), 'utf8'));
    const weights = new Map();
    map.sources.forEach((source, i) => {
      const hit = VENDORS.find(([pkg]) => source.includes(`node_modules/${pkg}`));
      if (hit) weights.set(hit, (weights.get(hit) ?? 0) + (map.sourcesContent?.[i]?.length ?? 0));
    });
    const total = (map.sourcesContent ?? []).reduce((s, c) => s + (c?.length ?? 0), 0);
    const [best] = [...weights.entries()].sort((a, b) => b[1] - a[1]);
    return best && best[1] > total / 2 ? best[0] : null;
  } catch {
    return null;
  }
};

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const initialSize = initial.reduce((sum, f) => sum + gz(f), 0);
const errors = [];
if (initialSize > budget.initialKB * KB)
  errors.push(`initial JS ${(initialSize / KB).toFixed(1)} KB > ${budget.initialKB} KB`);

const chunks = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'));
for (const name of chunks) {
  const file = `assets/${name}`;
  if (initial.includes(file)) continue;
  const size = gz(file);
  const vendor = vendorOf(file);
  const cap = vendor ? vendor[2] : budget.chunkKB;
  if (size > cap * KB)
    errors.push(
      `${file} (${vendor ? vendor[1] : 'route chunk'}) ${(size / KB).toFixed(1)} KB > ${cap} KB`,
    );
}

console.log(
  `initial JS: ${(initialSize / KB).toFixed(1)} KB gzip across ${initial.length} files; ${chunks.length} chunks checked`,
);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Bundle budgets OK.');
