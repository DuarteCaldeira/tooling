import { createHash } from 'node:crypto';
import { collect, createClient, loadConfig } from '../collect.mjs';

export const RELEASE_TTL = 60_000;

/** Shared snapshots survive cold starts; one refresh runs per function instance. */
export function createReleaseSource({ load, store, key, now = Date.now, ttl = RELEASE_TTL }) {
  let cached;
  let pending;
  let retryAt = 0;
  return async function snapshot() {
    if (cached && (now() - Date.parse(cached.generatedAt) < ttl || now() < retryAt)) return cached;
    if (!cached && now() < retryAt) throw new Error('Release data unavailable');
    if (!pending) {
      pending = (async () => {
        try {
          const shared = await store.get(key);
          if (
            shared?.schemaVersion === 1 &&
            Array.isArray(shared.apps) &&
            (!cached || Date.parse(shared.generatedAt) >= Date.parse(cached.generatedAt))
          )
            cached = shared;
        } catch {
          // A temporary cache outage must not prevent fetching GitHub directly.
        }
        if (cached && now() - Date.parse(cached.generatedAt) < ttl) return cached;
        try {
          const fresh = await load();
          // Keep releases available for conversations during a partial GitHub outage.
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
    }
    return pending;
  };
}

let source;
export async function releaseSnapshot() {
  if (!source) {
    if (!process.env.APPS_READ_TOKEN) throw new Error('Release data unavailable');
    const config = await loadConfig();
    const key = `release-cache/v1/${createHash('sha256').update(JSON.stringify(config)).digest('hex')}.json`;
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
  return source();
}

export function createReleaseHandler(getSnapshot = releaseSnapshot) {
  return async () => {
    const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    try {
      return Response.json(await getSnapshot(), { headers });
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
