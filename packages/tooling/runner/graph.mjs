import { defaults } from './config.mjs';

export function matches(file, pattern) {
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') {
        i++;
        regex += '(?:.*/)?';
      } else regex += '.*';
    } else if (c === '*') regex += '[^/]*';
    else if (c === '?') regex += '[^/]';
    else regex += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${regex}$`).test(file.replaceAll('\\', '/'));
}

export function classify(files, config = {}) {
  if (files === 'all') return ['all'];
  const paths = { ...defaults, ...config.paths };
  const groups = new Set();
  for (const file of files) {
    const found = Object.entries(paths)
      .filter(([, patterns]) => patterns.some((p) => matches(file, p)))
      .map(([key]) => key);
    if (found.includes('docs')) groups.add('docs');
    else if (found.includes('styles')) groups.add('styles');
    else if (found.includes('translations')) groups.add('translations');
    else if (found.length) found.forEach((g) => groups.add(g));
    else groups.add('unknown');
  }
  return [...groups].sort();
}

const full = ['push', 'ci'];
const all = ['dev', ...full];
const check = (command, groups, extra = {}) => ({ command, groups, profiles: full, ...extra });
export const builtins = {
  format: check(
    ['prettier', '--check', '.'],
    ['docs', 'styles', 'translations', 'app', 'database', 'functions', 'workflows'],
    {
      profiles: all,
      devCommand: ['prettier', '--check', '--ignore-unknown', '--'],
      devFiles: ['**/*'],
    },
  ),
  lint: check(['eslint', '.', '--max-warnings', '0'], ['app', 'functions'], {
    profiles: all,
    devCommand: ['eslint', '--max-warnings', '0', '--'],
    devFiles: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs'],
  }),
  styles: check(
    ['node', 'node_modules/@dcaldeira/repo-tooling/checks/lint-scss.mjs'],
    ['styles', 'app'],
    {
      profiles: all,
      devCommand: ['node', 'node_modules/@dcaldeira/repo-tooling/checks/lint-scss.mjs'],
      devFiles: ['**/*.scss'],
    },
  ),
  types: check(['tsc', '--build', '--pretty', 'false'], ['app', 'functions']),
  unit: check(['vitest', 'run', '--coverage'], ['app', 'functions'], {
    profiles: all,
    devCommand: ['vitest', 'related', '--run', '--passWithNoTests'],
    devAllCommand: ['vitest', 'run'],
    devFiles: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs'],
  }),
  translations: check(
    ['node', 'node_modules/@dcaldeira/repo-tooling/checks/translations.mjs'],
    ['translations', 'app'],
    { profiles: all },
  ),
  build: check(['npm', 'run', 'build'], ['app']),
  size: check(['npm', 'run', 'size'], ['app'], { dependsOn: ['build'] }),
  deadcode: check(['knip'], ['app']),
  security: check(
    'npm audit --audit-level=high && gitleaks git --redact',
    ['app', 'database', 'functions'],
    { tools: ['gitleaks'] },
  ),
  e2e: check(['playwright', 'test'], ['app'], { dependsOn: ['build'], platforms: ['linux'] }),
  visual: check(['playwright', 'test', '--grep', '@visual'], ['app'], {
    dependsOn: ['build'],
    platforms: ['linux'],
  }),
  lighthouse: check(['lhci', 'autorun'], ['app'], {
    dependsOn: ['build'],
    tools: ['lhci'],
    platforms: ['linux'],
  }),
  workflows: check(['actionlint', '-color'], ['workflows'], { tools: ['actionlint'] }),
};

export function plan(config, { files = 'all', profile = 'ci', only = [], skip = [] } = {}) {
  if (!['dev', 'push', 'ci'].includes(profile)) throw new Error(`Unknown profile: ${profile}`);
  const checks = Object.fromEntries(
    Object.entries({ ...builtins, ...config.checks })
      .filter(([, c]) => c !== false)
      .map(([id, c]) => [id, { ...builtins[id], ...c }]),
  );
  for (const id of [...only, ...skip]) if (!checks[id]) throw new Error(`Unknown check: ${id}`);
  for (const [id, c] of Object.entries(checks))
    if (!c.command || !c.groups || !c.profiles)
      throw new Error(`Custom check ${id} needs command, groups and profiles`);
  const groups = classify(files, config);
  const broad = groups.some((g) => ['all', 'tooling', 'dependencies', 'unknown'].includes(g));
  const required = new Set(
    Object.entries(checks)
      .filter(
        ([id, c]) =>
          c.profiles.includes(profile) &&
          (profile !== 'dev' ||
            id !== 'translations' ||
            broad ||
            groups.includes('translations')) &&
          (broad || c.groups.some((g) => groups.includes(g))),
      )
      .map(([id]) => id),
  );
  const wanted = new Set(only.length ? only : required);
  const visit = (id, chain = []) => {
    if (!checks[id]) throw new Error(`Missing dependency: ${id}`);
    if (chain.includes(id)) throw new Error(`Cyclic checks: ${[...chain, id].join(' -> ')}`);
    for (const dep of checks[id].dependsOn ?? []) {
      wanted.add(dep);
      visit(dep, [...chain, id]);
    }
  };
  [...wanted].forEach((id) => visit(id));
  const ordered = [];
  const seen = new Set();
  const order = (id) => {
    if (seen.has(id)) return;
    for (const dep of checks[id].dependsOn ?? []) order(dep);
    seen.add(id);
    ordered.push(id);
  };
  [...wanted].forEach(order);
  return {
    profile,
    groups,
    files,
    checks: ordered.map((id) => ({ id, ...checks[id], excluded: skip.includes(id) })),
    required: [...required],
    excluded: [...required].filter((id) => !wanted.has(id) || skip.includes(id)),
  };
}
