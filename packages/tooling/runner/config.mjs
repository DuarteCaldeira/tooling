import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const schema = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8'));
export const defaults = {
  docs: ['docs/**', '**/*.md', '**/*.mdx'],
  styles: ['**/*.scss', '**/*.css'],
  translations: ['**/locales/*.json'],
  app: ['src/**'],
  database: [],
  functions: [],
  workflows: ['.github/workflows/**'],
  tooling: ['tooling.config.json', '*config*', 'scripts/**', '.githooks/**'],
  dependencies: ['**/package.json', '**/package-lock.json', '**/npm-shrinkwrap.json'],
};
export const inside = (root, path) => {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel))
    throw new Error(`Path outside repository: ${path}`);
  return target;
};

// Interpret the keywords used by our bundled schema without adding dependencies to the planner.
function validate(value, rule, path) {
  const fail = (message) => {
    throw new Error(`${path}: ${message}`);
  };
  if (rule.oneOf) {
    let matches = 0;
    for (const option of rule.oneOf) {
      try {
        validate(value, option, path);
        matches++;
      } catch {}
    }
    if (matches !== 1) fail('must match exactly one allowed shape');
  }
  if ('const' in rule && value !== rule.const) fail(`must be ${rule.const}`);
  if (rule.enum && !rule.enum.includes(value)) fail(`must be one of ${rule.enum.join(', ')}`);
  if (rule.type) {
    const valid =
      rule.type === 'object'
        ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : rule.type === 'array'
          ? Array.isArray(value)
          : rule.type === 'integer'
            ? Number.isInteger(value)
            : rule.type === 'number'
              ? typeof value === 'number' && Number.isFinite(value)
              : typeof value === rule.type;
    if (!valid) fail(`must be ${rule.type}`);
  }
  if (typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) fail('must not be empty');
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail('invalid name');
  }
  if (typeof value === 'number') {
    if (rule.minimum !== undefined && value < rule.minimum) fail(`must be >= ${rule.minimum}`);
    if (rule.maximum !== undefined && value > rule.maximum) fail(`must be <= ${rule.maximum}`);
    if (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum)
      fail(`must be > ${rule.exclusiveMinimum}`);
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) fail('too few items');
    if (rule.maxItems !== undefined && value.length > rule.maxItems) fail('too many items');
    value.forEach((item, i) => {
      const itemRule = rule.prefixItems?.[i] ?? rule.items;
      if (itemRule) validate(item, itemRule, `${path}[${i}]`);
    });
  } else if (value !== null && typeof value === 'object') {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const [key, child] of Object.entries(value)) {
      if (rule.propertyNames) validate(key, rule.propertyNames, `${path}.${key}`);
      const childRule = rule.properties?.[key];
      if (childRule) validate(child, childRule, `${path}.${key}`);
      else if (rule.additionalProperties === false) fail(`unknown key ${key}`);
      else if (rule.additionalProperties && typeof rule.additionalProperties === 'object')
        validate(child, rule.additionalProperties, `${path}.${key}`);
    }
  }
}

export function validateConfig(value) {
  validate(value, schema, 'config');
  const layers = value.architecture?.layers ?? [];
  if (new Set(layers.map((layer) => layer.name)).size !== layers.length)
    throw new Error('Architecture layer names must be unique');
  for (const layer of layers)
    for (const name of layer.allow)
      if (!layers.some((candidate) => candidate.name === name))
        throw new Error(`Unknown architecture layer: ${name}`);
  for (const route of value.a11y?.routes ?? [])
    for (const action of route.actions ?? [])
      if (['fill', 'press'].includes(action.type) && action.value === undefined)
        throw new Error(`Accessibility action ${action.type} requires value`);
  for (const url of [value.a11y?.baseURL, value.a11y?.server?.url].filter(Boolean))
    if (!['http:', 'https:'].includes(new URL(url).protocol))
      throw new Error('Accessibility URLs must use HTTP or HTTPS');
  for (const path of value.execution?.typeScriptBuildInfo ?? [])
    if (/[\r\n]/.test(path) || !path.endsWith('.tsbuildinfo'))
      throw new Error('TypeScript cache paths must be .tsbuildinfo patterns');
  for (const [id, check] of Object.entries(value.checks ?? {})) {
    if (check && check.devFiles && check.devCommand && !Array.isArray(check.devCommand))
      throw new Error(`Changed-file command ${id} must be an array`);
  }
  return value;
}

export function loadConfig(root, path = process.env.TOOLING_CONFIG_PATH ?? 'tooling.config.json') {
  const raw = readFileSync(inside(root, path), 'utf8');
  const config = validateConfig(JSON.parse(raw));
  const paths = [
    ...(config.inputs ?? []),
    ...(config.execution?.typeScriptBuildInfo ?? []),
    ...(config.architecture?.include ?? []),
    ...(config.architecture?.exclude ?? []),
    ...(config.architecture?.tsconfig ? [config.architecture.tsconfig] : []),
    ...(config.architecture?.modules ?? []).flatMap((module) => [module.root, ...module.public]),
    ...(config.architecture?.layers ?? []).flatMap((layer) => layer.paths),
    ...(config.dependencyConsistency?.manifests ?? []),
    ...(config.dependencyConsistency?.include ?? []),
    ...(config.dependencyConsistency?.exclude ?? []),
    ...[
      config.generators?.components,
      config.generators?.hooks,
      config.a11y?.storageState,
      config.a11y?.server?.cwd,
    ].filter(Boolean),
    ...(config.reporting?.unit ?? []),
    ...(config.reporting?.coverage ?? []),
    ...(config.reporting?.playwright ?? []),
    ...Object.values(config.workspaces ?? {}).flatMap((workspace) => workspace.paths),
    ...Object.values(config.checks ?? {})
      .filter(Boolean)
      .flatMap((check) => [
        ...(check.cwd !== undefined ? [check.cwd] : []),
        ...(typeof check.cache === 'object' ? check.cache.inputs : []),
      ]),
  ];
  paths.forEach((path) => inside(root, path));
  return { config, raw };
}
