import { defaults } from './config.mjs';
import { fileURLToPath } from 'node:url';

const script = (name) => ['node', fileURLToPath(new URL(`../checks/${name}.mjs`, import.meta.url))];
const patterns = new Map();

function compile(pattern) {
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
  return new RegExp(`${regex}$`);
}

export function matches(file, pattern) {
  let regex = patterns.get(pattern);
  if (!regex) {
    regex = compile(pattern);
    if (patterns.size >= 2048) patterns.clear();
    patterns.set(pattern, regex);
  }
  return regex.test(file.replaceAll('\\', '/'));
}

export function workspaceClosure(config, names) {
  const closure = new Set();
  const visit = (name, chain = []) => {
    const workspace = config.workspaces?.[name];
    if (!workspace) throw new Error(`Unknown workspace: ${name}`);
    if (chain.includes(name))
      throw new Error(`Cyclic workspaces: ${[...chain, name].join(' -> ')}`);
    if (closure.has(name)) return;
    for (const dependency of workspace.dependsOn ?? []) visit(dependency, [...chain, name]);
    closure.add(name);
  };
  names.forEach((name) => visit(name));
  return [...closure];
}

export function workspaceFiles(config, names, files) {
  if (files === 'all' || !names?.length) return files;
  const paths = workspaceClosure(config, names).flatMap((name) => config.workspaces[name].paths);
  return files.filter((file) => {
    if (paths.some((pattern) => matches(file, pattern))) return true;
    const owned = Object.values(config.workspaces ?? {}).some((workspace) =>
      workspace.paths.some((pattern) => matches(file, pattern)),
    );
    // Unassigned source is conservatively shared; root documentation remains formatting-only.
    return !owned && classify([file], config).some((group) => group !== 'docs');
  });
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
    else if (
      Object.values(config.workspaces ?? {}).some((workspace) =>
        workspace.paths.some((pattern) => matches(file, pattern)),
      )
    )
      groups.add('app');
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
  lint: check(
    ['eslint', '.', '--max-warnings', '0', '--cache', '--cache-strategy', 'content'],
    ['app', 'functions'],
    {
      profiles: all,
      devCommand: ['eslint', '--max-warnings', '0', '--cache', '--cache-strategy', 'content', '--'],
      devFiles: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs'],
    },
  ),
  styles: check(script('lint-scss'), ['styles', 'app'], {
    profiles: all,
    devCommand: script('lint-scss'),
    devFiles: ['**/*.scss'],
  }),
  types: check(['tsc', '--build', '--pretty', 'false'], ['app', 'functions'], {
    resources: ['build'],
  }),
  unit: check(['vitest', 'run', '--coverage'], ['app', 'functions'], {
    profiles: all,
    devCommand: ['vitest', 'related', '--run', '--passWithNoTests'],
    devAllCommand: ['vitest', 'run'],
    devFiles: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs'],
  }),
  translations: check(script('translations'), ['translations', 'app'], { profiles: all }),
  build: check(['npm', 'run', 'build'], ['app'], { resources: ['build'] }),
  size: check(['npm', 'run', 'size'], ['app'], { dependsOn: ['build'] }),
  deadcode: check(['knip'], ['app']),
  security: check(
    'npm audit --audit-level=high && gitleaks git --redact',
    ['app', 'database', 'functions'],
    { tools: ['gitleaks'] },
  ),
  e2e: check(['playwright', 'test', '--grep-invert', '@visual'], ['app'], {
    dependsOn: ['build'],
    platforms: ['linux'],
    resources: ['browser'],
  }),
  visual: check(['playwright', 'test', '--grep', '@visual'], ['app'], {
    dependsOn: ['build'],
    platforms: ['linux'],
    resources: ['browser'],
  }),
  lighthouse: check(['lhci', 'autorun'], ['app'], {
    dependsOn: ['build'],
    tools: ['lhci'],
    platforms: ['linux'],
    resources: ['browser'],
  }),
  workflows: check(['actionlint', '-color'], ['workflows'], { tools: ['actionlint'] }),
  architecture: check(script('architecture'), ['app', 'functions'], { profiles: all }),
  'dependency-consistency': check(script('dependencies'), ['app', 'functions', 'dependencies']),
  a11y: check(script('a11y'), ['app'], {
    dependsOn: ['build'],
    resources: ['browser'],
    platforms: ['linux'],
  }),
};

const optIn = {
  architecture: 'architecture',
  'dependency-consistency': 'dependencyConsistency',
  a11y: 'a11y',
};

export function plan(config, { files = 'all', profile = 'ci', only = [], skip = [] } = {}) {
  if (!['dev', 'push', 'ci'].includes(profile)) throw new Error(`Unknown profile: ${profile}`);
  const checks = Object.fromEntries(
    Object.entries({ ...builtins, ...config.checks })
      .filter(
        ([id, c]) =>
          c !== false &&
          (!optIn[c.extends ?? id] ||
            config[optIn[c.extends ?? id]] ||
            Object.hasOwn(config.checks ?? {}, id)),
      )
      .map(([id, c]) => {
        if (c.extends && !builtins[c.extends])
          throw new Error(`Unknown check preset: ${c.extends}`);
        return [id, { ...builtins[c.extends ?? id], ...c, kind: c.extends ?? id }];
      }),
  );
  for (const id of [...only, ...skip]) if (!checks[id]) throw new Error(`Unknown check: ${id}`);
  for (const [id, c] of Object.entries(checks))
    if (!c.command || !c.groups || !c.profiles)
      throw new Error(`Custom check ${id} needs command, groups and profiles`);
  const groups = classify(files, config);
  const broad = groups.some((g) => ['all', 'tooling', 'dependencies', 'unknown'].includes(g));
  const workspaces = Object.keys(config.workspaces ?? {});
  workspaceClosure(config, workspaces);
  for (const check of Object.values(checks)) workspaceClosure(config, check.workspaces ?? []);
  const affectedWorkspaces = workspaces.filter(
    (name) => broad || workspaceFiles(config, [name], files).length,
  );
  const scopedFiles = (c) => (broad ? files : workspaceFiles(config, c.workspaces, files));
  const required = new Set(
    Object.entries(checks)
      .filter(
        ([id, c]) =>
          c.profiles.includes(profile) &&
          (profile !== 'dev' ||
            c.kind !== 'translations' ||
            broad ||
            groups.includes('translations')) &&
          (broad || c.groups.some((g) => classify(scopedFiles(c), config).includes(g))),
      )
      .map(([id]) => id),
  );
  const wanted = new Set(only.length ? only : required);
  const expanded = new Set();
  const visit = (id, chain = []) => {
    if (!checks[id]) throw new Error(`Missing dependency: ${id}`);
    if (chain.includes(id)) throw new Error(`Cyclic checks: ${[...chain, id].join(' -> ')}`);
    if (expanded.has(id)) return;
    for (const dep of checks[id].dependsOn ?? []) {
      wanted.add(dep);
      visit(dep, [...chain, id]);
    }
    expanded.add(id);
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
    affectedWorkspaces,
    checks: ordered.map((id) => ({
      id,
      ...checks[id],
      files: scopedFiles(checks[id]),
      excluded: skip.includes(id),
    })),
    required: [...required],
    excluded: [...required].filter((id) => !wanted.has(id) || skip.includes(id)),
  };
}
