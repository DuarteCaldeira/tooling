import test from 'node:test';
import assert from 'node:assert/strict';
import { createReleaseHandler, createReleaseSource } from '../dashboard/server/releases.mjs';
import { discussionManifest } from '../dashboard/release-items.mjs';
import { createDiscussionService, createHandler } from '../dashboard/server/discussions.mjs';
import { createDiscussionProvider } from '../dashboard/server/discussion-context.mjs';

test('reported conversations do not trigger GitHub collection and reuse their storage connection', async () => {
  const snapshot = {
    apps: [
      { repository: 'owner/app', releases: [{ version: 'v1.0.0', items: [], technicalItems: [] }] },
    ],
  };
  let opens = 0;
  const item = 'reported-00000000-0000-4000-8000-000000000001';
  const serviceFor = createDiscussionProvider({
    async readSnapshot(options) {
      assert.equal(options?.preferCached, true, 'A reported item must not refresh GitHub');
      return snapshot;
    },
    async openStore() {
      opens++;
      return { get: async () => ({ id: item }), list: async () => ({ blobs: [], hasMore: false }) };
    },
  });
  const input = { repository: 'owner/app', version: 'v1.0.0', item };
  const [first, second] = await Promise.all([serviceFor(input), serviceFor(input)]);
  assert.equal((await first.list(input)).total, 0);
  assert.equal((await second.list(input)).total, 0);
  assert.equal(opens, 1);
});

function fixture() {
  let time = Date.parse('2026-11-17T12:00:00Z');
  let version = 'v1.0.0';
  let failure = false;
  let calls = 0;
  const saved = new Map();
  const options = {
    key: 'snapshot',
    // Most tests expect an expired snapshot to wait for a refresh.
    stale: 0,
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

test('an expired snapshot is served at once while a refresh runs in the background', async () => {
  const f = fixture();
  const read = createReleaseSource({ ...f.options, stale: 300_000 });
  assert.equal((await read()).apps[0].version, 'v1.0.0');
  f.advance();
  assert.equal((await read()).apps[0].version, 'v1.0.0');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls(), 2);
  assert.equal((await read()).apps[0].version, 'v2.0.0');
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
  assert.equal(response.headers.get('cache-control'), 'private, no-cache');
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

test('known conversations reuse stale shared releases without collecting GitHub again', async () => {
  const f = fixture();
  const read = createReleaseSource(f.options);
  await read();
  f.advance();
  const cold = createReleaseSource(f.options);
  assert.equal((await cold({ preferCached: true })).apps[0].version, 'v1.0.0');
  assert.equal(f.calls(), 1);
  assert.equal((await cold()).apps[0].version, 'v2.0.0');
  assert.equal(f.calls(), 2);
  f.advance();
  assert.equal((await read({ preferCached: true })).apps[0].version, 'v1.0.0');
  assert.equal(f.calls(), 2);
});

test(
  'a blocked GitHub refresh does not block cached conversation requests',
  { timeout: 1000 },
  async () => {
    const f = fixture();
    const first = await createReleaseSource(f.options)();
    f.advance();
    const started = Promise.withResolvers();
    const loading = Promise.withResolvers();
    const read = createReleaseSource({
      ...f.options,
      load: () => {
        started.resolve();
        return loading.promise;
      },
    });
    const refresh = read();
    await started.promise;
    try {
      assert.equal(await read({ preferCached: true }), first);
    } finally {
      loading.resolve(await f.options.load());
      await refresh;
    }
  },
);

test('discussion context refreshes new releases while rejecting unknown applications without GitHub work', async () => {
  const f = fixture();
  const read = createReleaseSource(f.options);
  await read();
  f.advance();
  const serviceFor = createDiscussionProvider({
    readSnapshot: read,
    openStore: async () => ({ list: async () => ({ blobs: [], hasMore: false }) }),
  });
  const known = { repository: 'owner/app', version: 'v1.0.0', item: 'release' };
  const handler = createHandler(serviceFor);
  const response = await handler(
    new Request('https://hub.test/api/discussions?' + new URLSearchParams(known)),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 0);
  assert.equal(f.calls(), 1);
  const unknown = { ...known, repository: 'toString' };
  await assert.rejects((await serviceFor(unknown)).list(unknown), (error) => error.status === 404);
  assert.equal(f.calls(), 1);
  const discovered = { ...known, version: 'v2.0.0' };
  assert.equal((await (await serviceFor(discovered)).list(discovered)).total, 0);
  assert.equal(f.calls(), 2);
});

test('an unchanged release snapshot answers a revalidation with 304', async () => {
  const snapshot = { schemaVersion: 1, generatedAt: '2026-11-17T12:00:00Z', apps: [] };
  const handler = createReleaseHandler(async () => snapshot);
  const first = await handler(new Request('https://x.test/api/releases'));
  const etag = first.headers.get('etag');
  assert.equal(first.status, 200);
  const again = await handler(
    new Request('https://x.test/api/releases', { headers: { 'If-None-Match': etag } }),
  );
  assert.equal(again.status, 304);
});
