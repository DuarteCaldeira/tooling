import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_SECTIONS = ['Repository', 'Layout', 'Commands', 'Constraints'];
// Plugin set from the core plugin's repo-standard skill. Personal plugins (caveman) stay out.
const PLUGINS = ['core@dcaldeira', 'mattpocock-skills@mattpocock'];
const FRONTEND_PLUGINS = ['ui-ux-pro-max@ui-ux-pro-max-skill', 'taste-skill@taste-skill'];
const FRONTEND_DEPS = ['react', 'react-native', 'vite', 'next', 'expo'];

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);
const json = (path) => {
  try {
    return JSON.parse(read(path) ?? 'null');
  } catch {
    return null;
  }
};
const subdirs = (path) => {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
};

/**
 * True when the root, a workspace, any top-level folder or `apps/*`/`packages/*` depends on a
 * frontend framework. Keep in sync with `detectStack` in claude/hooks/lib/detect.mjs (a test
 * compares them).
 */
export function hasFrontend(root) {
  const rootManifest = json(join(root, 'package.json'));
  const patterns = [
    ...(Array.isArray(rootManifest?.workspaces)
      ? rootManifest.workspaces
      : (rootManifest?.workspaces?.packages ?? [])),
    '*',
    'apps/*',
    'packages/*',
  ];
  const dirs = patterns.flatMap((pattern) =>
    pattern.endsWith('*') ? subdirs(join(root, pattern.slice(0, -1))) : [join(root, pattern)],
  );
  return [rootManifest, ...dirs.map((dir) => json(join(dir, 'package.json')))].some((manifest) =>
    FRONTEND_DEPS.some(
      (dep) =>
        manifest?.dependencies?.[dep] ||
        manifest?.devDependencies?.[dep] ||
        manifest?.peerDependencies?.[dep],
    ),
  );
}
const exists = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/** Findings for the shared repo standard (opt-in through `repoStandard: true`). */
export function repoStandardFindings(root) {
  const findings = [];
  const fail = (message) =>
    findings.push({ status: 'failed', message: `repo standard: ${message}` });

  const agents = read(join(root, 'AGENTS.md'));
  if (agents === undefined) fail('add AGENTS.md');
  else {
    const headings = new Set([...agents.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]));
    for (const section of REQUIRED_SECTIONS)
      if (!headings.has(section)) fail(`AGENTS.md needs a "## ${section}" section`);
  }

  const claude = read(join(root, 'CLAUDE.md'));
  if (claude?.trim() !== '@AGENTS.md') fail('CLAUDE.md must contain only @AGENTS.md');

  for (const [name, text] of [
    ['AGENTS.md', agents],
    ['CLAUDE.md', claude],
  ])
    if (text && /(^|[\s`(/])\.ai[/\\]/m.test(text))
      fail(`${name} still references the old .ai/ kit`);
  if (exists(join(root, '.ai'))) fail('remove the .ai kit link');
  if (exists(join(root, 'ai-memory')))
    fail('move what is still useful out of ai-memory/ and delete it');

  let settings;
  try {
    settings = JSON.parse(read(join(root, '.claude', 'settings.json')) ?? 'null');
  } catch {
    fail('.claude/settings.json is not valid JSON');
  }
  if (settings !== undefined)
    for (const plugin of [...PLUGINS, ...(hasFrontend(root) ? FRONTEND_PLUGINS : [])])
      if (settings?.enabledPlugins?.[plugin] !== true)
        fail(`.claude/settings.json must enable ${plugin}`);

  if (!findings.length) findings.push({ status: 'passed', message: 'Repo standard is met' });
  return findings;
}
