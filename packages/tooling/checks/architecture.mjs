import { join, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig, inside } from '../runner/config.mjs';
import { matches } from '../runner/graph.mjs';
import {
  compilerOptions,
  importsIn,
  peer,
  rootDirectory,
  sourceFiles,
  writeDetails,
} from './shared.mjs';

export function analyseArchitecture(root, settings = {}, files, ts = peer('typescript', root)) {
  files ??= sourceFiles(root, settings.include ?? ['src/**'], settings.exclude ?? []);
  files = files.filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts'));
  if (!files.length)
    throw new Error(
      'No architecture source files matched; configure architecture.include for this project',
    );
  const included = new Set(files.map((file) => resolve(root, file)));
  const graph = new Map(files.map((file) => [file, []]));
  const options = compilerOptions(ts, root, settings.tsconfig);
  const resolutionCache = ts.createModuleResolutionCache(
    root,
    (file) => (ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase()),
    options,
  );
  const issues = [];
  if (settings.tsconfig && !existsSync(inside(root, settings.tsconfig)))
    throw new Error(`Missing architecture tsconfig: ${settings.tsconfig}`);
  const layers = settings.layers ?? [];
  const layerOf = (file) =>
    layers.find((layer) => layer.paths.some((pattern) => matches(file, pattern)));
  const under = (file, directory) =>
    file === directory || file.startsWith(directory.replace(/\/$/, '') + '/');
  for (const file of files) {
    const fromLayer = layerOf(file);
    for (const { specifier, line } of importsIn(ts, inside(root, file))) {
      if (/\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|woff2?|json)(?:\?|$)/i.test(specifier))
        continue;
      const resolved = ts.resolveModuleName(
        specifier,
        join(root, file),
        options,
        ts.sys,
        resolutionCache,
      ).resolvedModule;
      if (!resolved) {
        const local =
          specifier.startsWith('.') ||
          Object.keys(options.paths ?? {}).some((pattern) => matches(specifier, pattern));
        if (local)
          issues.push({
            file,
            line,
            rule: 'unresolved-import',
            message: `Cannot resolve ${specifier}`,
          });
        continue;
      }
      const target = relative(root, resolved.resolvedFileName).replaceAll('\\', '/');
      if (target.startsWith('../') || target.split('/').includes('node_modules')) continue;
      if (included.has(resolve(resolved.resolvedFileName))) graph.get(file).push(target);
      const toLayer = layerOf(target);
      if (
        fromLayer &&
        toLayer &&
        fromLayer.name !== toLayer.name &&
        !fromLayer.allow.includes(toLayer.name)
      )
        issues.push({
          file,
          line,
          rule: 'import-boundary',
          message: `${fromLayer.name} cannot import ${toLayer.name}: ${target}`,
        });
      for (const module of settings.modules ?? []) {
        const directory = module.root.replaceAll('\\', '/').replace(/\/$/, '');
        if (
          under(target, directory) &&
          !under(file, directory) &&
          !module.public.some((pattern) => matches(target, pattern))
        )
          issues.push({
            file,
            line,
            rule: 'private-module',
            message: `Import ${module.name} through a public entry, not ${target}`,
          });
      }
    }
  }
  if (settings.cycles !== false) {
    const visited = new Set(),
      active = new Set(),
      stack = [],
      reported = new Set();
    function visit(file) {
      if (active.has(file)) {
        const cycle = [...stack.slice(stack.indexOf(file)), file];
        const key = [...new Set(cycle)].sort().join('\0');
        if (!reported.has(key))
          issues.push({ file, rule: 'circular-import', message: cycle.join(' -> ') });
        reported.add(key);
        return;
      }
      if (visited.has(file)) return;
      active.add(file);
      stack.push(file);
      for (const target of graph.get(file) ?? []) visit(target);
      stack.pop();
      active.delete(file);
      visited.add(file);
    }
    for (const file of files) visit(file);
  }
  return {
    files: files.length,
    edges: [...graph.values()].reduce((sum, edges) => sum + edges.length, 0),
    issues,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = rootDirectory(),
    { config } = loadConfig(root);
  const result = analyseArchitecture(root, config.architecture, undefined, peer('typescript'));
  writeDetails({ architecture: result });
  for (const issue of result.issues)
    console.error(`${issue.file}:${issue.line ?? 1} ${issue.message} (${issue.rule})`);
  console.log(
    `Architecture: ${result.files} source files, ${result.edges} imports, ${result.issues.length} issues`,
  );
  process.exitCode = result.issues.length ? 1 : 0;
}
