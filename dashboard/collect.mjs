import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemId, changelogSections, technicalNotes } from './release-items.mjs';

const repositoryPattern = /^[\w.-]+\/[\w.-]+$/;
const exactVersion = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
const packageNames = ['@dcaldeira/tooling', '@dcaldeira/repo-tooling'];

export function validateConfig(config) {
  if (!repositoryPattern.test(config.toolingRepository) || !Array.isArray(config.apps))
    throw new Error('Expected toolingRepository and apps');
  const repositories = new Set();
  for (const app of config.apps) {
    if (!repositoryPattern.test(app.repository) || !app.name?.trim())
      throw new Error('Each app needs a name and owner/repository');
    const key = app.repository.toLowerCase();
    if (repositories.has(key)) throw new Error(`Duplicate repository: ${app.repository}`);
    repositories.add(key);
    for (const key of ['packagePath', 'lockPath', 'workflowPath', 'changelogPath']) {
      const path = app[key];
      if (
        path !== undefined &&
        (typeof path !== 'string' ||
          !path ||
          path.startsWith('/') ||
          path.includes('..') ||
          path.includes('\\'))
      )
        throw new Error(`Invalid ${key}`);
    }
  }
  return config;
}

export function createClient(token, fetchImpl = fetch) {
  const cache = new Map();
  return async function api(path, { optional = false } = {}) {
    if (!cache.has(path))
      cache.set(
        path,
        (async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            const response = await fetchImpl(`https://api.github.com${path}`, {
              headers: {
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              signal: AbortSignal.timeout(30000),
            });
            if (response.status === 404) return null;
            if (response.ok) return response.json();
            if (response.status >= 500 && attempt < 2) continue;
            throw new Error(`GitHub request failed (${response.status})`);
          }
        })(),
      );
    const result = await cache.get(path);
    if (result === null && !optional) throw new Error('Repository or ref unavailable (404)');
    return result;
  };
}

async function contents(api, repository, path, ref) {
  const data = await api(
    `/repos/${repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
    { optional: true },
  );
  if (!data) return null;
  if (data.encoding !== 'base64' || typeof data.content !== 'string')
    throw new Error('Unsupported repository file');
  return Buffer.from(data.content, 'base64').toString('utf8');
}

export async function releaseHistory(api, repository) {
  const releases = [];
  for (let page = 1; page <= 50; page++) {
    const batch = await api(`/repos/${repository}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Invalid release response');
    releases.push(...batch.filter((release) => !release.draft && release.published_at));
    if (batch.length < 100)
      return releases.sort(
        (a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || b.id - a.id,
      );
  }
  throw new Error('Release history exceeds pagination limit');
}

export async function latestRelease(api, repository) {
  return (await releaseHistory(api, repository))[0] ?? null;
}

export function productNotes(body = '') {
  if (typeof body !== 'string') return null;
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+(Novidades|Product updates)\s*$/i.test(line));
  if (start < 0) return null;
  const next = lines.slice(start + 1).findIndex((line) => /^##\s/.test(line));
  const section = lines.slice(start + 1, next < 0 ? undefined : start + 1 + next);
  const changes = section
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim());
  return changes.length
    ? { changes, language: /Novidades/i.test(lines[start]) ? 'pt-PT' : 'en' }
    : null;
}

export async function toolingAtRelease(api, app, sha, toolingRepository) {
  const packagePath = app.packagePath ?? 'package.json';
  const text = await contents(api, app.repository, packagePath, sha);
  const manifest = text ? JSON.parse(text) : {};
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  };
  const dependency = packageNames.find((name) => dependencies[name]);
  if (dependency) {
    const declared = dependencies[dependency];
    const lockText = await contents(api, app.repository, app.lockPath ?? 'package-lock.json', sha);
    const lock = lockText ? JSON.parse(lockText) : {};
    // A workspace can have its own installed version rather than the hoisted one.
    let directory = posix.dirname(packagePath);
    let locked;
    while (true) {
      const prefix = directory === '.' ? '' : `${directory}/`;
      locked = lock.packages?.[`${prefix}node_modules/${dependency}`]?.version;
      if (locked || directory === '.') break;
      directory = posix.dirname(directory);
    }
    locked ??= lock.dependencies?.[dependency]?.version;
    if (exactVersion.test(locked ?? ''))
      return { version: locked, declared, source: 'lockfile', status: 'tracked' };
    if (exactVersion.test(declared))
      return { version: declared, declared, source: 'package.json', status: 'tracked' };
    return { version: null, declared, source: 'package.json', status: 'unresolved' };
  }
  const workflow = await contents(
    api,
    app.repository,
    app.workflowPath ?? '.github/workflows/ci.yml',
    sha,
  );
  const escaped = toolingRepository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [
    ...(workflow ?? '').matchAll(
      new RegExp(
        `^\\s*uses:\\s*["']?${escaped}/\\.github/workflows/[^@\\s]+@([\\w./-]+)["']?\\s*(?:#.*)?$`,
        'gm',
      ),
    ),
  ];
  const refs = [...new Set(matches.map((match) => match[1]))];
  if (refs.length > 1)
    return { version: null, status: 'unresolved', source: 'workflow', declared: refs.join(', ') };
  if (refs.length === 1) {
    const ref = refs[0];
    // A moving branch cannot identify the tooling used by an earlier release.
    if (!/^[a-f\d]{40}$/i.test(ref))
      return { version: null, status: 'unresolved', source: 'workflow', declared: ref };
    const tooling = await contents(api, toolingRepository, 'packages/tooling/package.json', ref);
    const version = tooling ? JSON.parse(tooling).version : null;
    return {
      version: exactVersion.test(version ?? '') ? version : null,
      revision: ref,
      source: 'workflow',
      status: version ? 'tracked' : 'unresolved',
    };
  }
  return { version: null, status: 'not-adopted' };
}

export async function collect(config, api, now = new Date()) {
  validateConfig(config);
  const apps = [];
  for (const app of config.apps) {
    const row = {
      name: app.name,
      emoji: app.emoji ?? '📦',
      repository: app.repository,
      repositoryUrl: `https://github.com/${app.repository}`,
      version: null,
      releasedAt: null,
      tooling: { version: null, status: 'unknown' },
      releases: [],
    };
    try {
      // A missing release and a missing/private repository are different states.
      await api(`/repos/${app.repository}`);
      const history = await releaseHistory(api, app.repository);
      row.releases = history.map((item) => {
        const override = app.releaseNotes?.[item.tag_name.replace(/^v/, '')];
        const edited = override ?? productNotes(item.body);
        if (
          edited &&
          (!Array.isArray(edited.changes) ||
            edited.changes.some((change) => typeof change !== 'string'))
        )
          throw new Error('Invalid product release notes');
        return {
          version: item.tag_name,
          releasedAt: item.published_at,
          url: `https://github.com/${app.repository}/releases/tag/${encodeURIComponent(item.tag_name)}`,
          prerelease: Boolean(item.prerelease),
          notes: edited?.changes ?? [],
          summaryContext: edited?.context ?? null,
          language: edited?.language ?? null,
          source: override ? 'edited' : edited ? 'published' : 'github',
          originalNotes: typeof item.body === 'string' ? item.body : '',
        };
      });
      const release = history[0];
      if (!release) {
        apps.push({ ...row, status: 'unreleased' });
        continue;
      }
      const commit = await api(
        `/repos/${app.repository}/commits/${encodeURIComponent(release.tag_name)}`,
      );
      if (!/^[a-f\d]{40}$/i.test(commit.sha)) throw new Error('Invalid release commit');
      const changelog = await contents(
        api,
        app.repository,
        app.changelogPath ?? 'CHANGELOG.md',
        commit.sha,
      );
      const sections = changelogSections(changelog ?? '');
      for (const entry of row.releases) {
        const source = sections[entry.version.replace(/^v/, '')] ?? entry.originalNotes;
        entry.originalNotes = source;
        entry.technicalNotes = technicalNotes(source);
        entry.items = entry.notes.map((text, index) => ({
          id: app.releaseNotes?.[entry.version.replace(/^v/, '')]?.itemIds?.[index] ?? itemId(text),
          text,
        }));
        entry.technicalItems = entry.technicalNotes.map((text) => ({
          id: itemId(text, 'technical'),
          text,
        }));
      }
      Object.assign(row, {
        version: release.tag_name,
        releasedAt: release.published_at,
        releaseUrl: `https://github.com/${app.repository}/releases/tag/${encodeURIComponent(release.tag_name)}`,
        prerelease: release.prerelease,
        commit: commit.sha,
      });
      try {
        row.tooling = await toolingAtRelease(api, app, commit.sha, config.toolingRepository);
        row.status = 'released';
      } catch {
        row.status = 'partial';
      }
      apps.push(row);
    } catch {
      apps.push({ ...row, status: 'unavailable' });
    }
  }
  if (apps.length && apps.every((app) => app.status === 'unavailable'))
    throw new Error('All repositories are unavailable; previous deployment preserved');
  return {
    schemaVersion: 1,
    title: config.title ?? 'App overview',
    defaultApp: config.defaultApp ?? null,
    generatedAt: now.toISOString(),
    apps,
  };
}

export async function build({ configPath, output, api }) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const notesPath = new URL('./release-notes.json', import.meta.url);
  const notes = JSON.parse(await readFile(notesPath, 'utf8'));
  for (const releases of Object.values(notes))
    for (const note of Object.values(releases)) {
      if (
        !Array.isArray(note.changes) ||
        note.changes.some((text) => typeof text !== 'string') ||
        (note.itemIds &&
          (!Array.isArray(note.itemIds) ||
            note.itemIds.length !== note.changes.length ||
            note.itemIds.some((id) => !/^product-[a-f\d]{20}$/.test(id)) ||
            new Set(note.itemIds).size !== note.itemIds.length))
      )
        throw new Error('Invalid edited release notes or item IDs');
    }
  for (const app of config.apps) app.releaseNotes = notes[app.repository] ?? {};
  const snapshot = await collect(config, api);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'data.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const snapshot = await build({
    configPath: join(here, 'apps.json'),
    output: resolve(process.env.DASHBOARD_OUTPUT ?? '.tooling/dashboard-site'),
    api: createClient(process.env.APPS_READ_TOKEN ?? process.env.GITHUB_TOKEN),
  });
  console.log(
    `Built dashboard for ${snapshot.apps.length} apps (${snapshot.apps.filter((app) => ['unavailable', 'partial'].includes(app.status)).length} need attention)`,
  );
}
