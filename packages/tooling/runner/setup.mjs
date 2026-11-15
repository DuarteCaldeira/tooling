import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inside, loadConfig, validateConfig } from './config.mjs';
import { builtins, plan } from './graph.mjs';
import { executable, packageManifest } from './execute.mjs';
import { git } from './git.mjs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));
const json = (value) => JSON.stringify(value, null, 2) + '\n';

export function starterConfig({ preset = 'react-vite', app = 'frontend', scripts = {} } = {}) {
  if (!['react-vite', 'workspace'].includes(preset))
    throw new Error('Preset must be react-vite or workspace');
  if (!/^[\w-]+(?:\/[\w-]+)*$/.test(app))
    throw new Error('App must be a repository-relative directory');
  const workspace = preset === 'workspace';
  const cwd = workspace ? app : '.';
  const enabled = ['format', 'lint', 'types', 'unit', 'build'];
  const checks = Object.fromEntries(
    Object.keys(builtins).map((id) => [id, enabled.includes(id) ? {} : false]),
  );
  const adapters = { lint: 'lint', types: 'typecheck', unit: 'test:coverage', build: 'build' };
  for (const id of ['lint', 'types', 'unit', 'build']) {
    checks[id].cwd = cwd;
    if (workspace) checks[id].workspaces = ['app'];
    if (scripts[adapters[id]]) checks[id].command = ['npm', 'run', adapters[id]];
  }
  const config = {
    $schema: './node_modules/@dcaldeira/tooling/config.schema.json',
    schemaVersion: 1,
    execution: { concurrency: 2 },
    ...(workspace
      ? {
          paths: { app: [`${app}/src/**`, 'shared/src/**'] },
          workspaces: {
            app: { paths: [`${app}/**`], dependsOn: ['shared'] },
            shared: { paths: ['shared/**'] },
          },
        }
      : {}),
    checks,
  };
  validateConfig(config);
  return config;
}

export function initialize(root, { preset = 'react-vite', app = 'frontend', toolingSha } = {}) {
  if (toolingSha && !/^[a-f\d]{40}$/.test(toolingSha))
    throw new Error('--tooling-sha must be a full 40-character commit SHA');
  const packagePath = join(root, 'package.json');
  const pkg = readJSON(packagePath);
  const appPackage =
    preset === 'workspace' ? readJSON(join(inside(root, app), 'package.json')) : pkg;
  const config = starterConfig({ preset, app, scripts: appPackage.scripts });
  const aliases = {
    'check:dev': 'tooling --profile=dev --changed',
    'check:push': 'tooling --profile=push --changed --bail',
    'ci:local': 'tooling --profile=ci --all',
  };
  for (const [key, value] of Object.entries(aliases)) {
    if (pkg.scripts?.[key] && pkg.scripts[key] !== value)
      throw new Error(`Existing script ${key}; adapt it before initializing`);
  }
  const files = new Map([['tooling.config.json', json(config)]]);
  const template = (name) =>
    readFileSync(new URL(`../templates/${name}`, import.meta.url), 'utf8').replaceAll(
      'REPLACE_WITH_TOOLING_COMMIT_SHA',
      toolingSha ?? 'REPLACE_WITH_TOOLING_COMMIT_SHA',
    );
  files.set('.github/workflows/ci.yml', template('ci.yml'));
  files.set('.github/workflows/dependabot-merge.yml', template('dependabot-merge.yml'));
  files.set('.github/dependabot.yml', template('dependabot.yml'));
  files.set('.githooks/pre-push', template('pre-push'));
  files.set(
    'prettier.config.mjs',
    "export { default } from '@dcaldeira/tooling/configs/prettier.mjs';\n",
  );
  files.set('.nvmrc', '22.23.1\n');
  // Preserve existing formatter configuration and Node version files.
  if (
    [
      'prettier.config.mjs',
      'prettier.config.js',
      'prettier.config.cjs',
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.yml',
      '.prettierrc.yaml',
      '.prettierrc.js',
      '.prettierrc.cjs',
      '.prettierrc.toml',
    ].some((name) => existsSync(join(root, name))) ||
    pkg.prettier
  )
    files.delete('prettier.config.mjs');
  if (files.has('prettier.config.mjs'))
    files.set(
      '.github/workflows/ci.yml',
      files
        .get('.github/workflows/ci.yml')
        .replace('    with:\n', '    with:\n      lightweight-docs: true\n'),
    );
  if (existsSync(join(root, '.nvmrc'))) files.delete('.nvmrc');
  for (const path of files.keys())
    if (existsSync(join(root, path))) throw new Error(`Refusing to overwrite ${path}`);
  for (const name of ['.gitignore', '.prettierignore']) {
    const path = join(root, name);
    let text = existsSync(path) ? readFileSync(path, 'utf8') : '';
    for (const entry of [
      'node_modules/',
      'debug.log',
      '.tooling/',
      'dist/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      '*.tsbuildinfo',
    ]) {
      if (!text.split(/\r?\n/).includes(entry))
        text += `${text && !text.endsWith('\n') ? '\n' : ''}${entry}\n`;
    }
    files.set(name, text);
  }
  pkg.scripts = { ...pkg.scripts, ...aliases };
  pkg.devDependencies = { ...pkg.devDependencies, [manifest.name]: manifest.version };
  files.set('package.json', json(pkg));
  for (const [path, text] of files) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  chmodSync(join(root, '.githooks/pre-push'), 0o755);
  return [...files.keys()];
}

export function diagnose(root, configPath) {
  const findings = [];
  const add = (status, message) => findings.push({ status, message });
  let config;
  try {
    config = loadConfig(root, configPath).config;
    add('passed', 'Configuration is valid');
  } catch (error) {
    add('failed', error.message);
    return findings;
  }
  let selection;
  try {
    selection = plan(config, { profile: 'ci' });
    add('passed', 'Check dependencies form a valid graph');
  } catch (error) {
    add('failed', error.message);
    return findings;
  }
  if (!existsSync(join(root, 'package-lock.json')))
    add('failed', 'Run npm install and commit package-lock.json');
  if (!existsSync(join(root, '.nvmrc'))) add('failed', 'Add .nvmrc for the shared workflow');
  try {
    git(root, 'rev-parse', '--verify', 'HEAD');
    if (git(root, 'config', '--get', 'core.hooksPath') !== '.githooks')
      add('failed', 'Enable the hook: git config core.hooksPath .githooks');
  } catch {
    add('failed', 'Initialize Git, commit the project and enable .githooks');
  }
  for (const check of selection.checks) {
    const cwd = inside(root, check.cwd ?? '.');
    if (!existsSync(cwd)) {
      add('failed', `${check.id}: missing directory ${check.cwd}`);
      continue;
    }
    const commands = [check.command, check.devCommand, check.devAllCommand].filter(Array.isArray);
    const tools = new Set([...commands.map((command) => command[0]), ...(check.tools ?? [])]);
    for (const tool of tools)
      if (!executable(cwd, tool))
        add('failed', `${check.id}: missing ${tool} in ${check.cwd ?? '.'}`);
    for (const command of commands) {
      if (
        command[0] === 'node' &&
        command[1]?.endsWith('.mjs') &&
        !existsSync(join(cwd, command[1])) &&
        !existsSync(command[1])
      )
        add('failed', `${check.id}: missing script ${command[1]}`);
      if (command[0] === 'npm' && command[1] === 'run') {
        const pkgPath = join(cwd, 'package.json');
        if (!existsSync(pkgPath) || !readJSON(pkgPath).scripts?.[command[2]])
          add('failed', `${check.id}: missing npm script ${command[2]}`);
      }
    }
    if (check.platforms && !check.platforms.includes(process.platform))
      add('notice', `${check.id}: use ${check.platforms.join('/')} for canonical validation`);
    if ((check.kind ?? check.id) === 'styles' && !packageManifest(root, 'postcss-scss'))
      add('failed', 'styles: install postcss-scss and its postcss peer at the consumer root');
    if (
      ['architecture', 'dependency-consistency'].includes(check.kind ?? check.id) &&
      !packageManifest(cwd, 'typescript')
    )
      add('failed', `${check.id}: install TypeScript for import analysis`);
    if ((check.kind ?? check.id) === 'a11y') {
      if (!config.a11y?.routes?.length)
        add('failed', `${check.id}: configure a11y.baseURL and routes`);
      for (const name of ['@playwright/test', '@axe-core/playwright'])
        if (!packageManifest(cwd, name)) add('failed', `${check.id}: install ${name}`);
    }
    if (
      (check.kind ?? check.id) === 'unit' &&
      commands.some((command) => command.includes('--coverage')) &&
      !packageManifest(cwd, '@vitest/coverage-v8')
    )
      add('failed', 'unit: install @vitest/coverage-v8 matching your Vitest version');
  }
  for (const name of ['ci.yml', 'dependabot-merge.yml']) {
    const path = join(root, '.github/workflows', name);
    if (!existsSync(path)) add('failed', `Missing .github/workflows/${name}`);
    else if (readFileSync(path, 'utf8').includes('REPLACE_WITH_TOOLING_COMMIT_SHA'))
      add('failed', `Pin .github/workflows/${name} to the tooling commit SHA`);
  }
  return findings;
}

export async function setupCommand(command, root, options) {
  if (command === 'init') {
    const paths = initialize(root, {
      preset: options.preset,
      app: options.app,
      toolingSha: options['tooling-sha'],
    });
    console.log(
      `Created/adapted: ${paths.join(', ')}\nRun npm install, install the peer tools for your enabled checks, then tooling doctor.\nEnable the hook: git config core.hooksPath .githooks\nPin the workflow SHA if you did not pass --tooling-sha.`,
    );
    return 0;
  }
  const findings = diagnose(root, options.config);
  for (const finding of findings) console.log(`${finding.status}: ${finding.message}`);
  return findings.some((finding) => finding.status === 'failed') ? 1 : 0;
}
