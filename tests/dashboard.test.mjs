import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  build,
  collect,
  createClient,
  latestRelease,
  toolingAtRelease,
  validateConfig,
} from '../dashboard/collect.mjs';

const sha = 'a'.repeat(40);
const toolingSha = 'b'.repeat(40);
const app = { name: 'App', repository: 'owner/app' };
const config = { toolingRepository: 'owner/tooling', apps: [app] };
const file = (value) => ({
  encoding: 'base64',
  content: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString(
    'base64',
  ),
});
function mockApi(routes) {
  return async (path, { optional } = {}) => {
    if (Object.hasOwn(routes, path)) return routes[path];
    if (optional) return null;
    throw new Error(`Unexpected request: ${path}`);
  };
}
const release = {
  id: 1,
  tag_name: 'v1.2.0',
  published_at: '2026-11-14T10:00:00Z',
  draft: false,
  prerelease: false,
};
const baseRoutes = {
  '/repos/owner/app': { id: 1 },
  '/repos/owner/app/releases?per_page=100&page=1': [release],
  '/repos/owner/app/commits/v1.2.0': { sha },
};

test('dashboard records the release tag and locked tooling at its immutable commit', async () => {
  const snapshot = await collect(
    config,
    mockApi({
      ...baseRoutes,
      [`/repos/owner/app/contents/package.json?ref=${sha}`]: file({
        version: '99.0.0',
        devDependencies: { '@dcaldeira/tooling': '^0.2.0' },
      }),
      [`/repos/owner/app/contents/package-lock.json?ref=${sha}`]: file({
        packages: { 'node_modules/@dcaldeira/tooling': { version: '0.2.4' } },
      }),
    }),
    new Date('2026-11-15T00:00:00Z'),
  );
  assert.equal(snapshot.apps[0].version, 'v1.2.0');
  assert.equal(snapshot.apps[0].tooling.version, '0.2.4');
  assert.equal(snapshot.apps[0].releasedAt, release.published_at);
  assert.equal(snapshot.generatedAt, '2026-11-15T00:00:00.000Z');
});

test('dashboard selects by publication time across pages, includes prereleases and excludes drafts', async () => {
  const old = { ...release, published_at: '2020-01-01T00:00:00Z' };
  const newest = {
    ...release,
    id: 3,
    tag_name: 'v2.0.0-beta.1',
    published_at: '2026-11-15T00:00:00Z',
    prerelease: true,
  };
  const api = mockApi({
    '/repos/owner/app/releases?per_page=100&page=1': Array.from({ length: 100 }, () => old),
    '/repos/owner/app/releases?per_page=100&page=2': [
      newest,
      { ...newest, published_at: '2027-01-01T00:00:00Z', draft: true },
    ],
  });
  assert.equal((await latestRelease(api, app.repository)).tag_name, newest.tag_name);
});

test('dashboard distinguishes no release, inaccessible repository and absent tooling', async () => {
  const snapshot = await collect(
    {
      ...config,
      apps: [
        app,
        { name: 'New', repository: 'owner/new' },
        { name: 'Denied', repository: 'owner/denied' },
      ],
    },
    mockApi({
      ...baseRoutes,
      '/repos/owner/new': { id: 2 },
      '/repos/owner/new/releases?per_page=100&page=1': [],
    }),
  );
  assert.equal(snapshot.apps[0].tooling.status, 'not-adopted');
  assert.equal(snapshot.apps[1].status, 'unreleased');
  assert.equal(snapshot.apps[2].status, 'unavailable');
});

test('dashboard preserves release information if only tooling collection fails', async () => {
  const snapshot = await collect(
    config,
    mockApi({
      ...baseRoutes,
      [`/repos/owner/app/contents/package.json?ref=${sha}`]: file('{broken'),
    }),
  );
  assert.equal(snapshot.apps[0].status, 'partial');
  assert.equal(snapshot.apps[0].version, 'v1.2.0');
  assert.equal(snapshot.apps[0].tooling.status, 'unknown');
});

test('dashboard fails instead of replacing every app with unavailable data', async () => {
  await assert.rejects(collect(config, mockApi({})), /previous deployment preserved/);
});

test('dashboard does not present dependency ranges as resolved versions', async () => {
  const result = await toolingAtRelease(
    mockApi({
      [`/repos/owner/app/contents/package.json?ref=${sha}`]: file({
        devDependencies: { '@dcaldeira/tooling': '^1.0.0' },
      }),
    }),
    app,
    sha,
    config.toolingRepository,
  );
  assert.equal(result.status, 'unresolved');
  assert.equal(result.version, null);
  assert.equal(result.declared, '^1.0.0');
});

test('dashboard resolves the nearest workspace installation and legacy lockfiles', async () => {
  const routes = {
    [`/repos/owner/app/contents/frontend/package.json?ref=${sha}`]: file({
      devDependencies: { '@dcaldeira/tooling': '^2.0.0' },
    }),
    [`/repos/owner/app/contents/package-lock.json?ref=${sha}`]: file({
      packages: {
        'frontend/node_modules/@dcaldeira/tooling': { version: '2.1.0' },
        'node_modules/@dcaldeira/tooling': { version: '2.0.0' },
      },
    }),
  };
  assert.equal(
    (
      await toolingAtRelease(
        mockApi(routes),
        { ...app, packagePath: 'frontend/package.json' },
        sha,
        config.toolingRepository,
      )
    ).version,
    '2.1.0',
  );
  routes[`/repos/owner/app/contents/package-lock.json?ref=${sha}`] = file({
    dependencies: { '@dcaldeira/tooling': { version: '2.2.0' } },
  });
  assert.equal(
    (
      await toolingAtRelease(
        mockApi(routes),
        { ...app, packagePath: 'frontend/package.json' },
        sha,
        config.toolingRepository,
      )
    ).version,
    '2.2.0',
  );
});

test('dashboard resolves SHA-pinned workflows and declines moving refs', async () => {
  const workflowPath = `/repos/owner/app/contents/.github/workflows/ci.yml?ref=${sha}`;
  const routes = {
    [workflowPath]: file(
      `jobs:\n  ci:\n    uses: owner/tooling/.github/workflows/ci.yml@${toolingSha}\n`,
    ),
    [`/repos/owner/tooling/contents/packages/tooling/package.json?ref=${toolingSha}`]: file({
      version: '1.0.0',
    }),
  };
  const pinned = await toolingAtRelease(mockApi(routes), app, sha, config.toolingRepository);
  assert.equal(pinned.version, '1.0.0');
  assert.equal(pinned.revision, toolingSha);
  routes[workflowPath] = file(
    'jobs:\n  ci:\n    uses: owner/tooling/.github/workflows/ci.yml@main\n',
  );
  assert.equal(
    (await toolingAtRelease(mockApi(routes), app, sha, config.toolingRepository)).status,
    'unresolved',
  );
});

test('dashboard validates app allowlist and file paths before API access', () => {
  assert.throws(() => validateConfig({ ...config, apps: [app, app] }), /Duplicate/);
  assert.throws(
    () => validateConfig({ ...config, apps: [{ ...app, repository: 'https://evil.test' }] }),
    /owner\/repository/,
  );
  assert.throws(
    () => validateConfig({ ...config, apps: [{ ...app, packagePath: '../secrets' }] }),
    /Invalid/,
  );
});

test('dashboard API client keeps credentials in headers, handles 404 and retries server errors', async () => {
  let calls = 0;
  const api = createClient('secret-token', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/owner/app');
    assert.equal(options.headers.Authorization, 'Bearer secret-token');
    calls++;
    return calls === 1
      ? { status: 503, ok: false }
      : { status: 200, ok: true, json: async () => ({ id: 1 }) };
  });
  assert.deepEqual(await api('/repos/owner/app'), { id: 1 });
  await api('/repos/owner/app');
  assert.equal(calls, 2);
  const missing = createClient('', async () => ({ status: 404 }));
  assert.equal(await missing('/missing', { optional: true }), null);
  await assert.rejects(missing('/missing'), /404/);
});

test('dashboard build emits only static files and safe normalized data', async () => {
  const output = await mkdtemp(join(tmpdir(), 'tooling-dashboard-'));
  try {
    await build({
      configPath: new URL('../dashboard/apps.json', import.meta.url),
      output,
      api: async (path) =>
        path.includes('/releases?') ? [] : { id: 1, token: 'must-not-be-published' },
    });
    const data = await readFile(join(output, 'data.json'), 'utf8');
    assert.ok(!data.includes('must-not-be-published'));
    assert.ok((await readFile(join(output, 'index.html'), 'utf8')).includes('./app.js'));
    assert.ok((await readFile(join(output, 'app.js'), 'utf8')).includes('textContent'));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
