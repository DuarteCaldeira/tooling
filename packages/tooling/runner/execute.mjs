import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { inside } from './config.mjs';
import { matches } from './graph.mjs';

const bins = {
  prettier: 'prettier',
  eslint: 'eslint',
  vitest: 'vitest',
  playwright: '@playwright/test',
  knip: 'knip',
  tsc: 'typescript',
  lhci: '@lhci/cli',
};

export function executable(root, name) {
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
  const pkg = bins[name];
  if (pkg) {
    const manifest = join(root, 'node_modules', pkg, 'package.json');
    if (existsSync(manifest)) {
      const { bin } = JSON.parse(readFileSync(manifest, 'utf8'));
      const entry = typeof bin === 'string' ? bin : bin?.[name];
      if (entry) return [process.execPath, resolve(dirname(manifest), entry)];
    }
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
    const binary = executable(root, command[0]);
    if (!binary)
      return Promise.resolve({
        status: 'unavailable',
        reason: `Missing executable: ${command[0]}`,
      });
    [file, ...args] = [...binary, ...command.slice(1), ...extra];
    shell = false;
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
        PATH: `${join(root, 'node_modules/.bin')}${delimiter}${process.env.PATH}`,
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
  { bail = false, platform = process.platform, run = invoke } = {},
) {
  const results = selection.excluded.map((id) => ({
    id,
    status: 'excluded',
    reason: 'Required check intentionally excluded',
  }));
  const statuses = new Map();
  let stopped = false;
  const previousBuilt = process.env.REPO_TOOLING_BUILT;
  delete process.env.REPO_TOOLING_BUILT;
  const broad = selection.groups.some((g) =>
    ['all', 'tooling', 'dependencies', 'unknown'].includes(g),
  );
  for (const check of selection.checks) {
    if (check.excluded) {
      statuses.set(check.id, 'excluded');
      continue;
    }
    let result;
    if (stopped) result = { status: 'unavailable', reason: 'Not run after --bail' };
    else if ((check.dependsOn ?? []).some((id) => statuses.get(id) !== 'passed'))
      result = { status: 'unavailable', reason: 'Dependency did not pass' };
    else if (check.platforms && !check.platforms.includes(platform))
      result = {
        status: 'unavailable',
        reason: `Requires ${check.platforms.join('/')}; use Linux via WSL or a container`,
      };
    else if (check.tools?.some((tool) => !executable(root, tool)))
      result = {
        status: 'unavailable',
        reason: `Missing tools: ${check.tools.filter((tool) => !executable(root, tool)).join(', ')}`,
      };
    else {
      const devFiles = selection.profile === 'dev' && !broad && check.devCommand && check.devFiles;
      const files = devFiles
        ? selection.files.filter(
            (file) =>
              check.devFiles.some((pattern) => matches(file, pattern)) &&
              existsSync(inside(root, file)),
          )
        : [];
      if (devFiles && !files.length)
        result = {
          status: 'passed',
          reason: 'No remaining matching files (deleted files are checked by full profiles)',
        };
      else {
        const command = devFiles ? check.devCommand : check.command;
        console.log(
          `\n> ${check.id}: ${Array.isArray(command) ? command.join(' ') : command}${files.length ? ` (${files.length} files)` : ''}`,
        );
        result = await run(command, root, {
          cwd: inside(root, check.cwd ?? '.'),
          extra: files.map((file) => resolve(root, file)),
          env:
            ['e2e', 'visual'].includes(check.id) && process.env.REPO_TOOLING_REPORT_DIR
              ? {
                  PLAYWRIGHT_HTML_OUTPUT_DIR: join(process.env.REPO_TOOLING_REPORT_DIR, check.id),
                  REPO_TOOLING_TEST_OUTPUT_DIR: join(
                    process.env.REPO_TOOLING_REPORT_DIR,
                    `${check.id}-results`,
                  ),
                }
              : {},
        });
      }
    }
    results.push({ id: check.id, ...result });
    statuses.set(check.id, result.status);
    if (check.id === 'build' && result.status === 'passed') process.env.REPO_TOOLING_BUILT = '1';
    if (bail && result.status !== 'passed') stopped = true;
  }
  if (previousBuilt === undefined) delete process.env.REPO_TOOLING_BUILT;
  else process.env.REPO_TOOLING_BUILT = previousBuilt;
  return { results, complete: results.every((r) => r.status === 'passed') };
}
