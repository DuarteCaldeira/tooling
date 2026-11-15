import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  appendFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { invoke } from './execute.mjs';

export function formatterLock(root, selection) {
  if (
    selection.groups.length !== 1 ||
    selection.groups[0] !== 'docs' ||
    selection.checks.length !== 1 ||
    selection.checks[0].id !== 'format' ||
    selection.checks[0].excluded ||
    selection.excluded.length ||
    selection.checks[0].cwd ||
    JSON.stringify(selection.checks[0].command) !== JSON.stringify(['prettier', '--check', '.'])
  )
    return null;
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.['node_modules/prettier'];
  if (
    !entry?.version ||
    !entry.integrity ||
    !entry.resolved ||
    entry.link ||
    Object.keys(entry.dependencies ?? {}).length ||
    Object.keys(entry.optionalDependencies ?? {}).length ||
    Object.keys(entry.peerDependencies ?? {}).length
  )
    return null;
  return {
    name: 'tooling-docs',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'tooling-docs', version: '1.0.0', devDependencies: { prettier: entry.version } },
      'node_modules/prettier': { ...entry, dev: true, devOptional: undefined },
    },
  };
}

export async function installFormatter(root, lock) {
  const directory = join(root, '.tooling', 'formatter');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name: lock.name,
      version: lock.version,
      private: true,
      devDependencies: lock.packages[''].devDependencies,
    }),
  );
  writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock));
  const result = await invoke(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], root, {
    cwd: directory,
  });
  if (result.status !== 'passed') throw new Error('Formatter installation failed');
  const links = [
    [join(root, 'node_modules/prettier'), join(directory, 'node_modules/prettier')],
    [join(root, 'node_modules/@dcaldeira/tooling'), fileURLToPath(new URL('../', import.meta.url))],
  ];
  for (const [target, source] of links) {
    if (existsSync(target)) throw new Error(`Refusing to replace ${target}`);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd();
  const selection = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
  const lock = formatterLock(root, selection);
  if (process.argv.includes('--plan')) {
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `lightweight=${Boolean(lock)}\n`);
    console.log(
      lock
        ? 'Standalone formatter installation available'
        : 'Full dependency installation required',
    );
  } else {
    if (!lock) throw new Error('This plan requires the full project installation');
    await installFormatter(root, lock);
  }
}
