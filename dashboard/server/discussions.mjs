import { createHash, randomUUID } from 'node:crypto';

export class DiscussionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 32);
const appPrefix = (repository) => `discussions/v1/${digest(repository)}/`;
const threadPrefix = ({ repository, version, item }) =>
  `${appPrefix(repository)}${digest(version)}/${item}/comments/`;
const uuidPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

async function readBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 32000) {
      await reader.cancel();
      throw new DiscussionError(413, 'Comment request is too large');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function createDiscussionService({
  store,
  manifest,
  now = () => new Date(),
  uuid = randomUUID,
}) {
  function target(input) {
    const { repository, version, item = 'release' } = input;
    if (!Object.hasOwn(manifest, repository ?? ''))
      throw new DiscussionError(404, 'Application not found');
    if (
      !Object.hasOwn(manifest[repository], version ?? '') ||
      !manifest[repository][version].includes(item)
    )
      throw new DiscussionError(404, 'Release or change not found');
    return { repository, version, item };
  }
  async function metadata(prefix) {
    const all = [];
    let cursor;
    do {
      const page = await store.list(prefix, cursor);
      all.push(...page.blobs);
      if (all.length > 20000)
        throw new DiscussionError(413, 'Discussion archive is too large to load');
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return all;
  }
  return {
    async summary(repository) {
      if (!Object.hasOwn(manifest, repository ?? ''))
        throw new DiscussionError(404, 'Application not found');
      const blobs = await metadata(appPrefix(repository));
      const summary = {};
      for (const [version, items] of Object.entries(manifest[repository])) {
        summary[version] = {};
        for (const item of items) {
          const prefix = threadPrefix({ repository, version, item });
          summary[version][item] = blobs.filter((blob) => blob.pathname.startsWith(prefix)).length;
        }
      }
      return { summary };
    },
    async list(input) {
      const context = target(input);
      const offset = Number(input.cursor ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 20000)
        throw new DiscussionError(400, 'Invalid comment cursor');
      const blobs = (await metadata(threadPrefix(context))).sort(
        (a, b) =>
          new Date(b.uploadedAt) - new Date(a.uploadedAt) || b.pathname.localeCompare(a.pathname),
      );
      const comments = [];
      for (let start = offset; start < Math.min(offset + 50, blobs.length); start += 8) {
        comments.push(
          ...(
            await Promise.all(
              blobs
                .slice(start, Math.min(start + 8, offset + 50, blobs.length))
                .map((blob) => store.get(blob.pathname)),
            )
          ).filter(Boolean),
        );
      }
      return {
        comments,
        total: blobs.length,
        nextCursor: offset + 50 < blobs.length ? String(offset + 50) : null,
      };
    },
    async post(input, client = 'workspace') {
      const context = target(input);
      const author = typeof input.author === 'string' ? input.author.trim() : '';
      const body = typeof input.body === 'string' ? input.body.trim() : '';
      const kind = input.kind ?? 'comment';
      if (author.length < 2 || author.length > 60)
        throw new DiscussionError(400, 'Use a display name between 2 and 60 characters');
      if (!body || body.length > 4000)
        throw new DiscussionError(400, 'Write a comment of up to 4,000 characters');
      if (!['comment', 'question', 'issue'].includes(kind))
        throw new DiscussionError(400, 'Invalid comment type');
      const id = input.requestId ?? uuid();
      if (!uuidPattern.test(id)) throw new DiscussionError(400, 'Invalid comment request');
      const path = `${threadPrefix(context)}${id}.json`;
      const existing = await store.get(path);
      if (existing) {
        if (existing.author !== author || existing.body !== body || existing.kind !== kind)
          throw new DiscussionError(409, 'This request was already used for another comment');
        return existing;
      }
      const time = now();
      const bucket = Math.floor(time.getTime() / 60000);
      let allowed = false;
      for (let slot = 0; slot < 10; slot++) {
        if (
          await store.create(`rate-limits/v1/${digest(client)}/${bucket}/${slot}.json`, {
            expiresAt: time.getTime() + 120000,
          })
        ) {
          allowed = true;
          break;
        }
      }
      if (!allowed)
        throw new DiscussionError(429, 'Too many comments. Please wait a minute and try again');
      const comment = { id, ...context, author, body, kind, createdAt: time.toISOString() };
      if (!(await store.create(path, comment))) {
        const saved = await store.get(path);
        if (saved?.author === author && saved?.body === body && saved?.kind === kind) return saved;
        throw new DiscussionError(409, 'This request was already used');
      }
      if (store.remove) {
        try {
          const prefix = `rate-limits/v1/${digest(client)}/`;
          const expired = (await metadata(prefix)).filter(
            (blob) => Number(blob.pathname.slice(prefix.length).split('/')[0]) < bucket - 1,
          );
          if (expired.length) await store.remove(expired.map((blob) => blob.url));
        } catch {
          console.warn('release-discussions: rate-limit cleanup deferred');
        }
      }
      return comment;
    },
  };
}

export async function blobStore() {
  const { put, get, list, del } = await import('@vercel/blob');
  return {
    async create(path, value) {
      try {
        await put(path, JSON.stringify(value), {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
        });
        return true;
      } catch (error) {
        if (await get(path, { access: 'private', useCache: false })) return false;
        throw error;
      }
    },
    async get(path) {
      const file = await get(path, { access: 'private', useCache: false });
      if (!file) return null;
      if (file.statusCode !== 200) throw new Error('Private discussion read failed');
      return new Response(file.stream).json();
    },
    async list(prefix, cursor) {
      return list({ prefix, cursor, limit: 1000 });
    },
    async remove(urls) {
      await del(urls);
    },
  };
}

export function createHandler(serviceFactory) {
  return async function handle(request) {
    const headers = {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    };
    try {
      const url = new URL(request.url);
      if (!['GET', 'POST'].includes(request.method))
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { ...headers, Allow: 'GET, POST' },
        });
      if (request.method === 'POST') {
        if (
          request.headers.get('origin') !== url.origin ||
          !/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')
        )
          throw new DiscussionError(403, 'Use the discussion form on this site');
        const text = await readBody(request);
        let input;
        try {
          input = JSON.parse(text);
        } catch {
          throw new DiscussionError(400, 'Invalid comment request');
        }
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new DiscussionError(400, 'Invalid comment request');
        const service = await serviceFactory();
        const client =
          request.headers.get('x-vercel-forwarded-for') ??
          request.headers.get('x-forwarded-for') ??
          'workspace';
        const comment = await service.post(input, client);
        return new Response(JSON.stringify({ comment }), { status: 201, headers });
      }
      const service = await serviceFactory();
      const input = Object.fromEntries(url.searchParams);
      const result =
        input.view === 'summary'
          ? await service.summary(input.repository)
          : await service.list(input);
      return new Response(JSON.stringify(result), { status: 200, headers });
    } catch (error) {
      const status = error instanceof DiscussionError ? error.status : 503;
      if (status === 503) console.error('release-discussions: shared storage unavailable');
      return new Response(
        JSON.stringify({
          error:
            status === 503
              ? 'Shared discussions are temporarily unavailable. Your draft has not been sent'
              : error.message,
        }),
        { status, headers },
      );
    }
  };
}
