import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { inside } from './config.mjs';
import { matches } from './graph.mjs';
import { adaptCommand, detectPackageManager } from './package-manager.mjs';

const bins = {
  prettier: 'prettier',
  eslint: 'eslint',
  vitest: 'vitest',
  playwright: '@playwright/test',
  knip: 'knip',
  tsc: 'typescript',
  lhci: '@lhci/cli',
};

export function packageManifest(root, name) {
  for (let directory = resolve(root); ; directory = dirname(directory)) {
    const manifest = join(directory, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) return manifest;
    if (dirname(directory) === directory) return null;
  }
}

export function executable(root, name) {
  if (isAbsolute(name)) return existsSync(name) ? [name] : null;
  if (name === 'initdb' && process.env.PG_BIN) {
    const target = join(process.env.PG_BIN, process.platform === 'win32' ? 'initdb.exe' : 'initdb');
    if (existsSync(target)) return [target];
  }
  if (name === 'node') return [process.execPath];
  if (name === 'npm') {
    const candidates = [
      process.env.npm_execpath,
      join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    ];
    const cli = candidates.find((p) => p && /npm-cli\.js$/.test(p) && existsSync(p));
    if (cli) return [process.execPath, cli];
  }
  const pkg = bins[name] ?? name;
  for (let directory = resolve(root); ; directory = dirname(directory)) {
    const manifest = join(directory, 'node_modules', pkg, 'package.json');
    if (existsSync(manifest)) {
      const { bin } = JSON.parse(readFileSync(manifest, 'utf8'));
      const entry = typeof bin === 'string' ? bin : bin?.[name];
      if (entry) return [process.execPath, resolve(dirname(manifest), entry)];
    }
    if (dirname(directory) === directory) break;
  }
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const directory of (process.env.PATH ?? '').split(delimiter))
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      if (existsSync(candidate)) return [candidate];
    }
  return null;
}

export function invoke(command, root, { cwd = root, extra = [], quiet = false, env = {} } = {}) {
  let file, args, shell;
  if (Array.isArray(command)) {
    const binary = executable(cwd, command[0]);
    if (!binary)
      return Promise.resolve({
        status: 'unavailable',
        reason: `Missing executable: ${command[0]}`,
      });
    [file, ...args] = [...binary, ...command.slice(1), ...extra];
    shell = false;
    // Node refuses to spawn .cmd/.bat shims (pnpm.cmd) without a shell on Windows.
    if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(file)) {
      const quote = (value) =>
        /[\s&|<>^()"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
      [file, ...args] = [quote(file), ...args.map(quote)];
      shell = true;
    }
  } else {
    if (extra.length) throw new Error('Changed-file commands must use an argument array');
    file = command;
    args = [];
    shell = true;
  }
  return new Promise((done) => {
    const started = Date.now();
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        done({ ...result, milliseconds: Date.now() - started });
      }
    };
    const child = spawn(file, args, {
      cwd,
      shell,
      stdio: quiet ? 'ignore' : 'inherit',
      env: {
        ...process.env,
        ...env,
        PATH: `${join(cwd, 'node_modules/.bin')}${delimiter}${join(root, 'node_modules/.bin')}${delimiter}${process.env.PATH}`,
      },
    });
    child.once('error', (error) => finish({ status: 'unavailable', reason: error.message }));
    child.once('exit', (code, signal) =>
      finish({
        status: code === 0 ? 'passed' : 'failed',
        code,
        ...(signal ? { reason: signal } : {}),
      }),
    );
  });
}

export async function execute(
  root,
  selection,
  {
    bail = false,
    concurrency = bail ? 1 : 2,
    platform = process.platform,
    run = invoke,
    cache,
    toolCache = true,
  } = {},
) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw new Error('Concurrency must be an integer between 1 and 16');
  const excluded = new Set([
    ...selection.excluded,
    ...selection.checks.filter((c) => c.excluded).map((c) => c.id),
  ]);
  const statuses = new Map([...excluded].map((id) => [id, 'excluded']));
  const outcomes = new Map(
    [...excluded].map((id) => [
      id,
      { id, status: 'excluded', reason: 'Required check intentionally excluded' },
    ]),
  );
  const packageManager = detectPackageManager(root);
  const pending = selection.checks.filter((c) => !c.excluded);
  const running = new Map();
  const resources = new Set();
  let stopped = false;
  const broad = selection.groups.some((g) =>
    ['all', 'tooling', 'dependencies', 'unknown'].includes(g),
  );

  async function perform(check) {
    const cwd = inside(root, check.cwd ?? '.');
    const selectedFiles = check.files ?? selection.files;
    if (check.platforms && !check.platforms.includes(platform))
      return {
        status: 'unavailable',
        reason: 'Requires ' + check.platforms.join('/') + '; use Linux via WSL or a container',
      };
    const missing = (check.tools ?? []).filter((tool) => !executable(cwd, tool));
    if (missing.length)
      return { status: 'unavailable', reason: 'Missing tools: ' + missing.join(', ') };
    const deleted =
      selectedFiles !== 'all' &&
      check.devAllCommand &&
      selectedFiles.some(
        (file) =>
          check.devFiles?.some((pattern) => matches(file, pattern)) &&
          !existsSync(inside(root, file)),
      );
    const devFiles =
      selection.profile === 'dev' && !broad && !deleted && check.devCommand && check.devFiles;
    const files = devFiles
      ? selectedFiles.filter(
          (file) =>
            check.devFiles.some((pattern) => matches(file, pattern)) &&
            existsSync(inside(root, file)),
        )
      : [];
    if (devFiles && !files.length)
      return {
        status: 'passed',
        reason: 'No remaining matching files (deleted files are checked by full profiles)',
      };
    let command = devFiles
      ? check.devCommand
      : selection.profile === 'dev'
        ? (check.devAllCommand ?? check.command)
        : check.command;
    command = adaptCommand(command, packageManager);
    if (!toolCache && Array.isArray(command) && command[0] === 'eslint') {
      command = command.filter(
        (value, index, args) =>
          value !== '--cache' &&
          value !== '--cache-strategy' &&
          args[index - 1] !== '--cache-strategy',
      );
    }
    if (
      !toolCache &&
      Array.isArray(command) &&
      command[0] === 'tsc' &&
      command.includes('--build') &&
      !command.includes('--force')
    )
      command = [...command, '--force'];
    if (
      Array.isArray(command) &&
      command[0] === 'eslint' &&
      command.includes('--cache') &&
      !command.includes('--cache-location')
    ) {
      command = [...command];
      const end = command.indexOf('--');
      command.splice(
        end === -1 ? command.length : end,
        0,
        '--cache-location',
        join(root, '.tooling/cache/eslint', `${check.id}.cache`),
      );
    }
    const cached = cache?.get(check, command, files);
    if (cached) return cached;
    console.log(
      '\n> ' +
        check.id +
        ': ' +
        (Array.isArray(command) ? command.join(' ') : command) +
        (files.length ? ' (' + files.length + ' files)' : ''),
    );
    const env = {
      TOOLING_ROOT: root,
      TOOLING_CHECK_ID: check.id,
      TOOLING_BUILT: (check.dependsOn ?? ['build']).some(
        (id) =>
          statuses.get(id) === 'passed' &&
          selection.checks.some(
            (candidate) => candidate.id === id && (candidate.kind ?? candidate.id) === 'build',
          ),
      )
        ? '1'
        : '',
    };
    // Full-profile runs of change-scoped checks still get the selected files, as a list file
    // (a command line could overflow on large diffs). `--all` runs leave it unset.
    if (
      (check.kind ?? check.id) === 'duplication' &&
      Array.isArray(selectedFiles) &&
      !files.length
    ) {
      const list = join(root, '.tooling/state', `${check.id}-changed.txt`);
      mkdirSync(dirname(list), { recursive: true });
      writeFileSync(list, selectedFiles.join('\n'));
      env.TOOLING_CHANGED_FILES = list;
    }
    if ((check.kind ?? check.id) === 'unit' && process.env.TOOLING_REPORT_DIR)
      env.TOOLING_UNIT_OUTPUT_DIR = join(process.env.TOOLING_REPORT_DIR, `${check.id}-results`);
    if (['e2e', 'visual'].includes(check.kind ?? check.id) && process.env.TOOLING_REPORT_DIR) {
      env.PLAYWRIGHT_HTML_OUTPUT_DIR = join(process.env.TOOLING_REPORT_DIR, check.id);
      env.TOOLING_TEST_OUTPUT_DIR = join(process.env.TOOLING_REPORT_DIR, check.id + '-results');
    }
    return run(command, root, { cwd, extra: files.map((file) => resolve(root, file)), env });
  }

  function record(check, result) {
    outcomes.set(check.id, { id: check.id, kind: check.kind ?? check.id, ...result });
    statuses.set(check.id, result.status);
    if (bail && result.status !== 'passed') stopped = true;
  }

  while (pending.length || running.size) {
    for (let i = 0; i < pending.length;) {
      const check = pending[i];
      const deps = check.dependsOn ?? [];
      if (stopped || deps.some((id) => statuses.has(id) && statuses.get(id) !== 'passed')) {
        pending.splice(i, 1);
        record(check, {
          status: 'unavailable',
          reason: stopped ? 'Not run after --bail' : 'Dependency did not pass',
        });
        continue;
      }
      if (
        running.size >= concurrency ||
        deps.some((id) => !statuses.has(id)) ||
        (check.resources ?? []).some((key) => resources.has(key))
      ) {
        i++;
        continue;
      }
      pending.splice(i, 1);
      for (const key of check.resources ?? []) resources.add(key);
      const task = Promise.resolve()
        .then(() => perform(check))
        .catch((error) => ({ status: 'unavailable', reason: error.message }))
        .then((result) => {
          record(check, result);
          running.delete(check.id);
          for (const key of check.resources ?? []) resources.delete(key);
        });
      running.set(check.id, task);
    }
    if (running.size) await Promise.race(running.values());
    else if (pending.length) {
      for (const check of pending.splice(0))
        record(check, { status: 'unavailable', reason: 'Unresolved dependencies' });
    }
  }
  const ids = [...new Set([...excluded, ...selection.checks.map((c) => c.id)])];
  const results = ids.map((id) => outcomes.get(id));
  return { results, complete: results.every((r) => r.status === 'passed') };
}
