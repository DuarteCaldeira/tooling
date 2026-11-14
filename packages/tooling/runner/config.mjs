import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const groups = [
  'docs',
  'styles',
  'translations',
  'app',
  'database',
  'functions',
  'workflows',
  'tooling',
  'dependencies',
];
export const defaults = {
  docs: ['docs/**', '**/*.md', '**/*.mdx'],
  styles: ['**/*.scss', '**/*.css'],
  translations: ['**/locales/*.json'],
  app: ['src/**'],
  database: [],
  functions: [],
  workflows: ['.github/workflows/**'],
  tooling: ['repo-tooling.config.json', '*config*', 'scripts/**', '.githooks/**'],
  dependencies: ['**/package.json', '**/package-lock.json', '**/npm-shrinkwrap.json'],
};
export const inside = (root, path) => {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path outside repository: ${path}`);
  return target;
};

export function validateConfig(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1)
    throw new Error('schemaVersion must be 1');
  const allowed = [
    'schemaVersion',
    '$schema',
    'paths',
    'checks',
    'environment',
    'inputs',
    'release',
    'budgets',
    'translations',
    'styles',
  ];
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Unknown configuration key: ${key}`);
  for (const [key, patterns] of Object.entries(value.paths ?? {})) {
    if (
      !groups.includes(key) ||
      !Array.isArray(patterns) ||
      patterns.some((p) => typeof p !== 'string')
    )
      throw new Error(`Invalid paths.${key}`);
  }
  for (const [id, check] of Object.entries(value.checks ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`Invalid check id: ${id}`);
    if (check === false) continue;
    if (!check || typeof check !== 'object') throw new Error(`Invalid check: ${id}`);
    for (const key of Object.keys(check))
      if (
        ![
          'command',
          'devCommand',
          'devAllCommand',
          'groups',
          'profiles',
          'dependsOn',
          'cwd',
          'tools',
          'platforms',
          'devFiles',
        ].includes(key)
      )
        throw new Error(`Unknown checks.${id}.${key}`);
    for (const key of ['command', 'devCommand', 'devAllCommand'])
      if (
        check[key] !== undefined &&
        typeof check[key] !== 'string' &&
        (!Array.isArray(check[key]) ||
          !check[key].length ||
          check[key].some((x) => typeof x !== 'string'))
      )
        throw new Error(`Invalid ${id}.${key}`);
    if (check.cwd !== undefined && typeof check.cwd !== 'string')
      throw new Error(`Invalid ${id}.cwd`);
    if (check.devFiles && check.devCommand && !Array.isArray(check.devCommand))
      throw new Error(`Changed-file command ${id} must be an array`);
    for (const key of ['groups', 'profiles', 'dependsOn', 'tools', 'platforms', 'devFiles'])
      if (
        check[key] !== undefined &&
        (!Array.isArray(check[key]) || check[key].some((x) => typeof x !== 'string'))
      )
        throw new Error(`Invalid ${id}.${key}`);
    if (check.groups?.some((x) => ![...groups, 'unknown'].includes(x)))
      throw new Error(`Invalid groups: ${id}`);
    if (check.profiles?.some((x) => !['dev', 'push', 'ci'].includes(x)))
      throw new Error(`Invalid profiles: ${id}`);
  }
  for (const key of ['environment', 'inputs']) {
    if (
      value[key] !== undefined &&
      (!Array.isArray(value[key]) || value[key].some((entry) => typeof entry !== 'string'))
    )
      throw new Error(`Invalid ${key}`);
  }
  return value;
}

export function loadConfig(
  root,
  path = process.env.REPO_TOOLING_CONFIG_PATH ?? 'repo-tooling.config.json',
) {
  const raw = readFileSync(inside(root, path), 'utf8');
  return { config: validateConfig(JSON.parse(raw)), raw };
}
