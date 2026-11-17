import test from 'node:test';
import assert from 'node:assert/strict';
import { createReleaseHandler, createReleaseSource } from '../dashboard/server/releases.mjs';
import { discussionManifest } from '../dashboard/release-items.mjs';
import { createDiscussionService } from '../dashboard/server/discussions.mjs';

function fixture() {
  let time = Date.parse('2026-11-17T12:00:00Z');
  let version = 'v1.0.0';
  let failure = false;
  let calls = 0;
  const saved = new Map();
  const options = {
    key: 'snapshot',
    now: () => time,
    store: { get: async (key) => saved.get(key), set: async (key, value) => saved.set(key, value) },
    load: async () => {
      calls++;
      if (failure) throw new Error('secret-token must not leak');
      return {
        schemaVersion: 1,
        generatedAt: new Date(time).toISOString(),
        apps: [
          {
            repository: 'owner/app',
            version,
            releases: [{ version, items: [], technicalItems: [] }],
          },
        ],
      };
    },
  };
  return {
    options,
    saved,
    calls: () => calls,
    advance: () => {
      time += 60_001;
      version = 'v2.0.0';
    },
    fail: () => {
      failure = true;
    },
  };
}

test('runtime refresh shares cached data across cold starts and discovers new releases without builds', async () => {
  const f = fixture();
  const read = createReleaseSource(f.options);
  const first = await read();
  assert.equal((await createReleaseSource(f.options)()).apps[0].version, 'v1.0.0');
  assert.equal(f.calls(), 1);
  f.advance();
  const [next, concurrent] = await Promise.all([read(), read()]);
  assert.equal(next.apps[0].version, 'v2.0.0');
  assert.equal(concurrent, next);
  assert.notEqual(first, next);
  assert.equal(f.calls(), 2);
  assert.equal(f.saved.get('snapshot'), next);
});

test('GitHub failures preserve the last snapshot and back off refresh attempts', async () => {
  const f = fixture();
  const read = createReleaseSource(f.options);
  const first = await read();
  f.advance();
  f.fail();
  assert.equal(await read(), first);
  assert.equal(await read(), first);
  assert.equal(f.calls(), 2);
});

test('cache outages still allow live collection', async () => {
  const f = fixture();
  const read = createReleaseSource({
    ...f.options,
    store: {
      get: async () => {
        throw new Error('offline');
      },
      set: async () => {
        throw new Error('offline');
      },
    },
  });
  assert.equal((await read()).apps[0].version, 'v1.0.0');
});

test('partial GitHub outages retain previously discovered releases for inaccessible apps', async () => {
  const f = fixture();
  let partial = false;
  const read = createReleaseSource({
    ...f.options,
    load: async () => {
      if (!partial) return f.options.load();
      return {
        schemaVersion: 1,
        generatedAt: '2026-11-17T12:01:00.001Z',
        apps: [{ repository: 'owner/app', status: 'unavailable', releases: [] }],
      };
    },
  });
  await read();
  f.advance();
  partial = true;
  const next = await read();
  assert.equal(next.apps[0].status, 'unavailable');
  assert.equal(next.apps[0].version, 'v1.0.0');
  assert.deepEqual(discussionManifest(next)['owner/app']['v1.0.0'], ['release']);
});

test('release endpoint avoids browser caching and returns sanitized errors without a snapshot', async () => {
  const f = fixture();
  const read = createReleaseSource(f.options);
  const handler = createReleaseHandler(read);
  const response = await handler();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const failed = fixture();
  failed.fail();
  const unavailable = await createReleaseHandler(createReleaseSource(failed.options))();
  assert.equal(unavailable.status, 503);
  assert.ok(!(await unavailable.text()).includes('secret-token'));
});

test('new runtime releases are accepted by discussion validation', async () => {
  const f = fixture();
  const read = createReleaseSource(f.options);
  await read();
  f.advance();
  const service = createDiscussionService({
    manifest: discussionManifest(await read()),
    store: { list: async () => ({ blobs: [], hasMore: false }) },
  });
  const result = await service.list({
    repository: 'owner/app',
    version: 'v2.0.0',
    item: 'release',
  });
  assert.deepEqual(result.comments, []);
});
