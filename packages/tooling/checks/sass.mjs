import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import scss from 'postcss-scss';
import { inside, loadConfig } from '../runner/config.mjs';
import { matches } from '../runner/graph.mjs';

export function importantViolations(source, file, exceptions = []) {
  const tree = scss.parse(source, { from: file });
  if (exceptions.some((pattern) => matches(file, pattern))) return [];
  const failures = [];
  tree.walkDecls((declaration) => {
    if (declaration.important)
      failures.push(`${file}:${declaration.source?.start?.line ?? 1}: avoid !important; use tokens or cascade structure`);
  });
  return failures;
}

export async function checkSass(root, options, { compile } = {}) {
  if (!options?.entrypoints?.length) throw new Error('Configure sass.entrypoints');
  const source = inside(root, options.source ?? 'src');
  const includes = options.include ?? ['**/*.scss'];
  const excludes = options.exclude ?? [];
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const file = relative(root, path).replaceAll('\\', '/');
      if (excludes.some((pattern) => matches(file, pattern))) continue;
      if (entry.isSymbolicLink()) throw new Error(`Sass source must not contain symlinks: ${file}`);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && includes.some((pattern) => matches(file, pattern))) files.push(path);
    }
  };
  walk(source);
  if (!files.length) throw new Error('No SCSS files matched sass.include');
  const entrypoints = options.entrypoints.map((file) => inside(root, file));
  const compiler = compile ?? createRequire(join(root, 'package.json'))('sass').compileAsync;
  const failures = [];
  for (const file of entrypoints) {
    try {
      await compiler(file, { style: 'compressed' });
    } catch (error) {
      failures.push(`${relative(root, file)}: Sass compilation failed: ${error.message}`);
    }
  }
  for (const path of files) {
    const file = relative(root, path).replaceAll('\\', '/');
    try {
      failures.push(...importantViolations(readFileSync(path, 'utf8'), file, options.importantExceptions));
    } catch (error) {
      failures.push(`${file}:${error.line ?? 1}: SCSS parsing failed: ${error.reason ?? error.message}`);
    }
  }
  return { files: files.length, entrypoints: entrypoints.length, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.TOOLING_ROOT ?? process.cwd();
  const { config } = loadConfig(root);
  const result = await checkSass(root, config.sass);
  if (result.failures.length) {
    console.error(result.failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`Sass checks passed (${result.files} files, ${result.entrypoints} entrypoints).`);
}
