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
const statePrefix = ({ repository, version, item }) =>
  `${appPrefix(repository)}${digest(version)}/${item}/state/`;
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
      throw new DiscussionError(413, 'O comentário é demasiado longo');
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
      throw new DiscussionError(404, 'Aplicação não encontrada');
    if (
      !Object.hasOwn(manifest[repository], version ?? '') ||
      !manifest[repository][version].includes(item)
    )
      throw new DiscussionError(404, 'Versão ou alteração não encontrada');
    return { repository, version, item };
  }
  async function metadata(prefix) {
    const all = [];
    let cursor;
    do {
      const page = await store.list(prefix, cursor);
      all.push(...page.blobs);
      if (all.length > 20000)
        throw new DiscussionError(413, 'Esta conversa é demasiado extensa para carregar');
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return all;
  }
  return {
    async summary(repository) {
      if (!Object.hasOwn(manifest, repository ?? ''))
        throw new DiscussionError(404, 'Aplicação não encontrada');
      const blobs = await metadata(appPrefix(repository));
      const summary = {};
      const states = {};
      for (const [version, items] of Object.entries(manifest[repository])) {
        summary[version] = {};
        states[version] = {};
        for (const item of items) {
          const context = { repository, version, item };
          const comments = blobs.filter((blob) => blob.pathname.startsWith(threadPrefix(context)));
          summary[version][item] = comments.length;
          states[version][item] = { validated: false, closed: false };
          for (const field of ['validated', 'closed']) {
            const events = blobs
              .filter((blob) => blob.pathname.startsWith(`${statePrefix(context)}${field}/`))
              .sort(
                (a, b) =>
                  new Date(b.uploadedAt) - new Date(a.uploadedAt) ||
                  b.pathname.localeCompare(a.pathname),
              );
            if (!events.length) continue;
            states[version][item][field] = events[0].pathname.endsWith('.true.json');
            if (
              field === 'closed' &&
              comments.some(
                (comment) => new Date(comment.uploadedAt) > new Date(events[0].uploadedAt),
              )
            )
              states[version][item].closed = false;
          }
        }
      }
      return { summary, states };
    },
    async setState(input) {
      const context = target(input);
      if (!['validated', 'closed'].includes(input.field) || typeof input.value !== 'boolean')
        throw new DiscussionError(400, 'Estado de revisão inválido');
      if (
        (context.item === 'release' || context.item.startsWith('technical-')) &&
        input.field === 'validated'
      )
        throw new DiscussionError(400, 'A validação aplica-se apenas às novidades de produto');
      const id = input.requestId;
      if (!uuidPattern.test(id ?? '')) throw new DiscussionError(400, 'Pedido de revisão inválido');
      const path = `${statePrefix(context)}${input.field}/${id}.${input.value}.json`;
      if (await store.get(`${statePrefix(context)}${input.field}/${id}.${!input.value}.json`))
        throw new DiscussionError(409, 'Este pedido já foi utilizado');
      const event = {
        ...context,
        field: input.field,
        value: input.value,
        createdAt: now().toISOString(),
      };
      if (!(await store.create(path, event))) {
        const saved = await store.get(path);
        if (saved?.value !== input.value)
          throw new DiscussionError(409, 'Este pedido já foi utilizado');
      }
      return { saved: true };
    },
    async list(input) {
      const context = target(input);
      const offset = Number(input.cursor ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 20000)
        throw new DiscussionError(400, 'Página de comentários inválida');
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
      const participantId = input.participantId;
      if (participantId !== undefined && !uuidPattern.test(participantId))
        throw new DiscussionError(400, 'Identificação do participante inválida');
      if (author.length < 2 || author.length > 60)
        throw new DiscussionError(400, 'Indique um nome entre 2 e 60 caracteres');
      if (!body || body.length > 4000)
        throw new DiscussionError(400, 'Escreva um comentário com até 4 000 caracteres');
      if (!['comment', 'question', 'issue'].includes(kind))
        throw new DiscussionError(400, 'Tipo de comentário inválido');
      const id = input.requestId ?? uuid();
      if (!uuidPattern.test(id)) throw new DiscussionError(400, 'Pedido de comentário inválido');
      const path = `${threadPrefix(context)}${id}.json`;
      const existing = await store.get(path);
      if (existing) {
        if (
          existing.author !== author ||
          existing.body !== body ||
          existing.kind !== kind ||
          existing.participantId !== participantId
        )
          throw new DiscussionError(409, 'Este pedido já foi utilizado para outro comentário');
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
        throw new DiscussionError(
          429,
          'Demasiados comentários. Aguarde um minuto e tente novamente',
        );
      const comment = {
        id,
        ...context,
        author,
        body,
        kind,
        ...(participantId ? { participantId } : {}),
        createdAt: time.toISOString(),
      };
      if (!(await store.create(path, comment))) {
        const saved = await store.get(path);
        if (
          saved?.author === author &&
          saved?.body === body &&
          saved?.kind === kind &&
          saved?.participantId === participantId
        )
          return saved;
        throw new DiscussionError(409, 'Este pedido já foi utilizado');
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
        return new Response(JSON.stringify({ error: 'Método não permitido' }), {
          status: 405,
          headers: { ...headers, Allow: 'GET, POST' },
        });
      if (request.method === 'POST') {
        if (
          request.headers.get('origin') !== url.origin ||
          !/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')
        )
          throw new DiscussionError(403, 'Use o formulário de conversa deste painel');
        const text = await readBody(request);
        let input;
        try {
          input = JSON.parse(text);
        } catch {
          throw new DiscussionError(400, 'Pedido de comentário inválido');
        }
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new DiscussionError(400, 'Pedido de comentário inválido');
        const service = await serviceFactory();
        const client =
          request.headers.get('x-vercel-forwarded-for') ??
          request.headers.get('x-forwarded-for') ??
          'workspace';
        if (input.action === 'state')
          return new Response(JSON.stringify(await service.setState(input)), {
            status: 200,
            headers,
          });
        if (input.action && input.action !== 'comment')
          throw new DiscussionError(400, 'Ação inválida');
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
              ? 'As conversas estão temporariamente indisponíveis. O seu rascunho não foi enviado'
              : error.message,
        }),
        { status, headers },
      );
    }
  };
}
