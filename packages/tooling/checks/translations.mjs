import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, inside } from '../runner/config.mjs';

export const flatten = (value, prefix = '') =>
  Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' ? flatten(child, path) : [[path, child]];
  });
const placeholders = (value) =>
  [...String(value).matchAll(/\{\{\s*(-?\s*[\w.]+)(?:\s*,[^}]*)?\s*\}\}/g)]
    .map((m) => m[1].trim())
    .sort()
    .join(',');

export function validateCatalogues(catalogues, source, { pluralExceptions = [] } = {}) {
  const errors = [];
  const base = new Map(flatten(catalogues[source]));
  for (const [locale, catalogue] of Object.entries(catalogues)) {
    const entries = new Map(flatten(catalogue));
    for (const [key, value] of entries) {
      if (typeof value !== 'string' || !value.trim())
        errors.push(`${locale}: ${key} must be a non-empty string`);
      if (!base.has(key)) errors.push(`${locale}: extra key ${key}`);
      else if (placeholders(value) !== placeholders(base.get(key)))
        errors.push(`${locale}: ${key} interpolation differs from ${source}`);
      const plural = key.match(/^(.*)_(zero|one|two|few|many|other)$/);
      if (plural && !pluralExceptions.includes(plural[1]) && !entries.has(`${plural[1]}_other`))
        errors.push(`${locale}: ${plural[1]}_other is missing`);
    }
    for (const key of base.keys())
      if (!entries.has(key)) errors.push(`${locale}: missing key ${key}`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.TOOLING_ROOT ?? process.cwd();
  const { config } = loadConfig(root);
  if (!config.translations?.directory || !config.translations?.source)
    throw new Error('Configure translations.directory and translations.source');
  const directory = inside(root, config.translations.directory);
  const catalogues = Object.fromEntries(
    readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => [name.slice(0, -5), JSON.parse(readFileSync(join(directory, name), 'utf8'))]),
  );
  if (!catalogues[config.translations.source]) throw new Error('Authoritative catalogue not found');
  const errors = validateCatalogues(catalogues, config.translations.source, config.translations);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`Translation parity passed (${Object.keys(catalogues).length} catalogues)`);
}
