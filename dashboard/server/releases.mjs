import { createHash } from 'node:crypto';
import { collect, createClient, loadConfig } from '../collect.mjs';

export const RELEASE_TTL = 60_000;
// Past the TTL a snapshot is still served at once while a refresh runs behind it.
export const RELEASE_STALE = 300_000;

export function createReleaseSource({
  load,
  store,
  key,
  now = Date.now,
  ttl = RELEASE_TTL,
  stale = RELEASE_STALE,
}) {
  let cached;
  let pending;
  let reading;
  let retryAt = 0;
  let checkedAt = -Infinity;

  async function readShared() {
    if (now() - checkedAt < ttl) return;
    if (!reading) {
      reading = (async () => {
        try {
          const shared = await store.get(key);
          if (
            shared?.schemaVersion === 1 &&
            Array.isArray(shared.apps) &&
            (!cached || Date.parse(shared.generatedAt) >= Date.parse(cached.generatedAt))
          )
            cached = shared;
        } catch {
          // Keep live collection and known releases available during cache outages.
        } finally {
          checkedAt = now();
        }
      })().finally(() => {
        reading = undefined;
      });
    }
    await reading;
  }

  return async function snapshot({ preferCached = false } = {}) {
    if (preferCached) {
      if (cached) return cached;
      await readShared();
      if (cached) return cached;
    }
    const age = cached ? now() - Date.parse(cached.generatedAt) : Infinity;
    if (cached && (age < ttl || now() < retryAt)) return cached;
    if (!cached && now() < retryAt) throw new Error('Release data unavailable');
    const refresh = () => {
      if (pending) return pending;
      pending = (async () => {
        await readShared();
        if (cached && now() - Date.parse(cached.generatedAt) < ttl) return cached;
        try {
          const fresh = await load();
          for (const app of fresh.apps) {
            if (app.status !== 'unavailable') continue;
            const previous = cached?.apps.find((entry) => entry.repository === app.repository);
            if (previous) Object.assign(app, previous, { status: 'unavailable' });
          }
          cached = fresh;
          retryAt = 0;
          try {
            await store.set(key, fresh);
          } catch {
            console.warn('release-dashboard: snapshot persistence unavailable');
          }
          return cached;
        } catch {
          retryAt = now() + ttl;
          if (cached) return cached;
          throw new Error('Release data unavailable');
        }
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    };
    if (cached && age < ttl + stale) {
      refresh().catch(() => {});
      return cached;
    }
    return refresh();
  };
}

let source;
export async function releaseSnapshot(options) {
  if (!source) {
    if (!process.env.APPS_READ_TOKEN) throw new Error('Release data unavailable');
    const config = await loadConfig();
    const key = `release-cache/v2/${createHash('sha256').update(JSON.stringify(config)).digest('hex')}.json`;
    const { get, put } = await import('@vercel/blob');
    source ??= createReleaseSource({
      key,
      // Use a new client per refresh: its request cache belongs to this collection only.
      load: () =>
        collect(
          config,
          createClient(process.env.APPS_READ_TOKEN, fetch, AbortSignal.timeout(45_000)),
        ),
      store: {
        async get(path) {
          const file = await get(path, { access: 'private', useCache: false });
          if (!file || file.statusCode !== 200) return null;
          return new Response(file.stream).json();
        },
        async set(path, value) {
          await put(path, JSON.stringify(value), {
            access: 'private',
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: 'application/json',
          });
        },
      },
    });
  }
  return source(options);
}

export function createReleaseHandler(getSnapshot = releaseSnapshot) {
  return async (request) => {
    const headers = { 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' };
    try {
      const snapshot = await getSnapshot();
      // Polling revalidates: an unchanged snapshot costs a 304 instead of the whole body.
      const etag = `"${snapshot.generatedAt}"`;
      headers.ETag = etag;
      if (request?.headers?.get('if-none-match') === etag)
        return new Response(null, { status: 304, headers });
      return Response.json(snapshot, { headers });
    } catch {
      return Response.json(
        { error: 'As versões estão temporariamente indisponíveis' },
        {
          status: 503,
          headers,
        },
      );
    }
  };
}
