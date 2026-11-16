import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { browserChecks } from './browsers.mjs';
import { inside, loadConfig } from './config.mjs';

export function planMetadata(root, selection, config, lock = {}) {
  const active = Boolean(selection.checks.length || selection.excluded.length);
  const browsers = browserChecks(selection).length > 0;
  const versions = Object.entries(lock.packages ?? {})
    .filter(([path]) => /node_modules\/(?:@playwright\/test|playwright(?:-core)?)$/.test(path))
    .map(([path, entry]) => [path, entry.version]);
  const paths = ['.tooling/cache/eslint/'];
  for (const path of config.execution?.typeScriptBuildInfo ?? []) {
    inside(root, path);
    if (/[\r\n]/.test(path) || !path.endsWith('.tsbuildinfo'))
      throw new Error('TypeScript cache paths must be repository-relative .tsbuildinfo patterns');
    paths.push(path);
  }
  return {
    active: String(active),
    browsers: String(browsers),
    history: String(config.history?.enabled !== false),
    'browser-key': createHash('sha256')
      .update(JSON.stringify(versions.sort()))
      .digest('hex')
      .slice(0, 20),
    'tool-cache-paths': paths.join('\n'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd();
  const selection = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const { config } = loadConfig(root, process.env.CONFIG ?? 'tooling.config.json');
  const lockPath = join(root, 'package-lock.json');
  const metadata = planMetadata(
    root,
    selection,
    config,
    existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : {},
  );
  for (const [name, value] of Object.entries(metadata)) {
    const delimiter = `tooling_${randomUUID()}`;
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
  console.log(
    metadata.active === 'true'
      ? 'Plan requires validation'
      : 'Empty plan: installation and validation skipped',
  );
}
