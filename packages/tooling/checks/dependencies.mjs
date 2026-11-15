import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
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

export function analyseDependencies(root, settings = {}, manifests, lock, files, ts) {
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const workspacePatterns = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : (rootManifest.workspaces?.packages ?? []);
  manifests ??= settings.manifests ?? [
    'package.json',
    ...sourceFiles(root, ['**/package.json']).filter(
      (file) =>
        file !== 'package.json' &&
        workspacePatterns.some((pattern) => matches(dirname(file).replaceAll('\\', '/'), pattern)),
    ),
  ];
  const packages = [...new Set(manifests)].map((file) => ({
    file,
    directory: dirname(file).replaceAll('\\', '/'),
    manifest: JSON.parse(readFileSync(inside(root, file), 'utf8')),
  }));
  const named = new Map();
  const issues = [],
    warnings = [],
    declarations = new Map();
  for (const pkg of packages) {
    const name = pkg.manifest.name;
    if (name && named.has(name))
      issues.push({
        rule: 'duplicate-workspace-name',
        file: pkg.file,
        message: `Duplicate package name ${name}`,
      });
    if (name) named.set(name, pkg);
    for (const section of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ])
      for (const [name, range] of Object.entries(pkg.manifest[section] ?? {})) {
        const list = declarations.get(name) ?? [];
        list.push({ pkg, section, range });
        declarations.set(name, list);
      }
  }
  function versionRange(name, entry) {
    const range = entry.range;
    if (typeof range !== 'string') {
      issues.push({
        rule: 'invalid-range',
        file: entry.pkg.file,
        message: `${name}: dependency range must be a string`,
      });
      return null;
    }
    const local = named.get(name);
    if (range.startsWith('workspace:')) {
      if (!local) {
        issues.push({
          rule: 'missing-workspace',
          file: entry.pkg.file,
          message: `${name} uses workspace: but no workspace declares that name`,
        });
        return null;
      }
      const value = range.slice(10);
      return ['*', '^', '~'].includes(value)
        ? value === '*'
          ? local.manifest.version
          : value + local.manifest.version
        : value;
    }
    if (/^(?:file|link):/.test(range)) {
      if (
        local &&
        resolve(root, entry.pkg.directory, range.replace(/^[^:]+:/, '')) !==
          resolve(root, local.directory)
      )
        issues.push({
          rule: 'workspace-target',
          file: entry.pkg.file,
          message: `${name} points to a different local directory`,
        });
      return local?.manifest.version ?? null;
    }
    if (range.startsWith('npm:')) {
      const at = range.lastIndexOf('@');
      return at > 4 ? range.slice(at + 1) : '*';
    }
    return semver.validRange(range) ? range : null;
  }
  for (const [name, entries] of declarations) {
    if (settings.ignore?.includes(name)) continue;
    const normalized = entries.map((entry) => ({
      ...entry,
      normalized: versionRange(name, entry),
    }));
    if (settings.strict?.includes(name) && new Set(entries.map((entry) => entry.range)).size > 1)
      issues.push({
        rule: 'version-drift',
        message: `${name}: ranges differ: ${entries.map((entry) => `${entry.pkg.file}=${entry.range}`).join(', ')}`,
      });
    const expected = settings.expected?.[name];
    if (expected && !semver.validRange(expected))
      throw new Error(`Invalid expected range for ${name}: ${expected}`);
    for (let i = 0; i < normalized.length; i++) {
      const entry = normalized[i],
        local = named.get(name);
      if (entry.normalized && !semver.validRange(entry.normalized)) {
        issues.push({
          rule: 'invalid-range',
          file: entry.pkg.file,
          message: `${name}: invalid workspace range ${entry.range}`,
        });
        continue;
      }
      if (expected && (!entry.normalized || !semver.subset(entry.normalized, expected)))
        issues.push({
          rule: 'expected-version',
          file: entry.pkg.file,
          message: `${name}: ${entry.range} permits versions outside ${expected}`,
        });
      if (
        local &&
        entry.normalized &&
        (!semver.valid(local.manifest.version) ||
          !semver.satisfies(local.manifest.version, entry.normalized))
      )
        issues.push({
          rule: 'workspace-version',
          file: entry.pkg.file,
          message: `${name}@${local.manifest.version} does not satisfy ${entry.range}`,
        });
      for (let j = i + 1; j < normalized.length; j++) {
        const other = normalized[j];
        if (
          entry.normalized &&
          other.normalized &&
          semver.validRange(other.normalized) &&
          !semver.intersects(entry.normalized, other.normalized)
        )
          issues.push({
            rule: 'incompatible-ranges',
            message: `${name}: ${entry.pkg.file} (${entry.range}) and ${other.pkg.file} (${other.range}) are incompatible`,
          });
      }
    }
  }
  if (lock === undefined) {
    try {
      lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const versions = new Map();
  for (const [path, entry] of Object.entries(lock?.packages ?? {})) {
    const match = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/);
    if (!match || !entry.version || entry.link) continue;
    const set = versions.get(match[1]) ?? new Set();
    set.add(entry.version);
    versions.set(match[1], set);
  }
  for (const [name, set] of versions)
    if (set.size > 1 && !settings.ignore?.includes(name)) {
      const issue = {
        rule: 'duplicate-versions',
        message: `${name}: lockfile contains ${[...set].sort().join(', ')}`,
      };
      (settings.singleVersion?.includes(name) ? issues : warnings).push(issue);
    }
  if (settings.checkImports !== false && packages.length > 1) {
    ts ??= peer('typescript', root);
    files ??= sourceFiles(root, settings.include ?? ['**/src/**'], settings.exclude ?? []);
    const byDirectory = [...packages].sort((a, b) => b.directory.length - a.directory.length);
    const owner = (file) =>
      byDirectory.find((pkg) => pkg.directory === '.' || file.startsWith(pkg.directory + '/'));
    const options = new Map(
      packages.map((pkg) => [
        pkg,
        compilerOptions(
          ts,
          root,
          pkg.directory === '.' ? 'tsconfig.json' : `${pkg.directory}/tsconfig.json`,
        ),
      ]),
    );
    for (const file of files.filter((file) => /\.[cm]?[jt]sx?$/.test(file))) {
      const from = owner(file);
      if (!from) continue;
      for (const { specifier, line } of importsIn(ts, inside(root, file))) {
        const internal = [...named].find(
          ([name]) => specifier === name || specifier.startsWith(name + '/'),
        );
        const resolved = ts.resolveModuleName(
          specifier,
          join(root, file),
          options.get(from),
          ts.sys,
        ).resolvedModule;
        const target =
          internal?.[1] ??
          (resolved
            ? owner(relative(root, resolved.resolvedFileName).replaceAll('\\', '/'))
            : null);
        if (!target || target === from || !target.manifest.name || target.directory === '.')
          continue;
        const name = target.manifest.name;
        if (
          !['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some(
            (section) => Object.hasOwn(from.manifest[section] ?? {}, name),
          )
        )
          issues.push({
            rule: 'undeclared-workspace-import',
            file,
            line,
            message: `${from.manifest.name ?? from.file} imports ${name} without declaring it`,
          });
        if (!internal)
          issues.push({
            rule: 'workspace-path-import',
            file,
            line,
            message: `Import ${name} by package name instead of crossing workspace directories: ${specifier}`,
          });
      }
    }
  }
  return { packages: packages.length, issues, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = rootDirectory(),
    { config } = loadConfig(root);
  const result = analyseDependencies(
    root,
    config.dependencyConsistency,
    undefined,
    undefined,
    undefined,
    config.dependencyConsistency?.checkImports === false ? undefined : peer('typescript'),
  );
  writeDetails({ dependencies: result });
  for (const issue of result.issues)
    console.error(
      `${issue.file ?? 'dependencies'}:${issue.line ?? 1} ${issue.message} (${issue.rule})`,
    );
  console.log(
    `Dependency consistency: ${result.packages} packages, ${result.issues.length} errors, ${result.warnings.length} duplicate-version notices`,
  );
  process.exitCode = result.issues.length ? 1 : 0;
}
