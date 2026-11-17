import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDiscussionService, createHandler } from '../dashboard/server/discussions.mjs';
import { changelogSections, technicalNotes, itemId } from '../dashboard/release-items.mjs';
import { portugueseDate, itemTopics } from '../dashboard/src/lib/topics.js';

test('topic tags identify product areas and cross-cutting concerns without changing item IDs', () => {
  const text = 'Exames: importar relatórios fica mais rápido e com mais contraste.';
  const before = itemId(text);
  const topics = itemTopics(text).map((topic) => topic.id);
  assert.ok(topics.includes('exames'));
  assert.ok(topics.includes('dados'));
  assert.ok(topics.includes('performance'));
  assert.ok(topics.includes('acessibilidade'));
  assert.ok(
    itemTopics('Privacidade: proteção ao importar ficheiros.').some(
      (topic) => topic.label === 'Segurança',
    ),
  );
  assert.equal(itemTopics('chore: update dependencies', true)[0].id, 'manutencao');
  assert.equal(itemId(text), before);
});

test('every change gets a tag besides its area, falling back to a reusable change type', () => {
  const kinds = (text, technical = false) =>
    itemTopics(text, technical)
      .filter((topic) => topic.kind !== 'area')
      .map((topic) => topic.id);
  assert.deepEqual(kinds('Perfil: novo campo para registar problemas de saúde.'), ['novidade']);
  assert.deepEqual(kinds('Análises: unidade dos Leucócitos corrigida.'), ['correcao']);
  assert.deepEqual(kinds('Treinos: mais nomes sugeridos nos detalhes.'), ['melhoria']);
  assert.deepEqual(kinds('test: close coverage gaps', true), ['testes']);
  assert.deepEqual(kinds('refactor(log): remove the card', true), ['refatoracao']);
  assert.deepEqual(kinds('chore: update dependencies', true), ['manutencao']);
  assert.ok(kinds('Texto qualquer sem tema').length >= 1);
});

test('technical changes reject validation and comments use display names without browser identity', async () => {
  const { service, input } = fixture();
  await assert.rejects(
    service.setState({
      ...input,
      item: 'technical-one',
      field: 'validated',
      value: true,
      requestId: randomUUID(),
    }),
    (error) => error.status === 400,
  );
  const first = await service.post(
    { ...input, requestId: randomUUID(), participantId: randomUUID() },
    'one',
  );
  const second = await service.post(
    { ...input, requestId: randomUUID(), participantId: randomUUID() },
    'two',
  );
  assert.equal(first.author, second.author);
  assert.notEqual(first.id, second.id);
  assert.equal('participantId' in first, false);
  assert.equal('participantId' in second, false);
  const retry = await service.post({ ...input, requestId: first.id, participantId: randomUUID() });
  assert.equal(retry.id, first.id);
});

test('Portuguese dates include release time and follow Lisbon daylight saving time', () => {
  assert.equal(portugueseDate('2026-11-15T23:47:00Z'), '15 de novembro, 2026 23:47');
  assert.equal(portugueseDate('2026-07-15T23:47:00Z'), '16 de julho, 2026 00:47');
});

test('validation and resolved conversations are shared, reversible and scoped to each item', async () => {
  const { store, manifest, input } = fixture();
  let clock = 0;
  const service = createDiscussionService({
    store,
    manifest,
    now: () => new Date(1794786000000 + clock++ * 1000),
  });
  const state = (field, value) =>
    service.setState({ ...input, field, value, requestId: randomUUID() });
  assert.equal(
    (await service.summary(input.repository)).states[input.version][input.item].validated,
    false,
  );
  await state('validated', true);
  await service.post(input);
  await state('closed', true);
  const another = createDiscussionService({ store, manifest });
  let result = await another.summary(input.repository);
  assert.deepEqual(result.states[input.version][input.item], { validated: true, closed: true });
  assert.equal(result.summary[input.version][input.item], 1);
  assert.equal(result.states['v2.0.0'][input.item].validated, false);
  await service.post({ ...input, body: 'A new finding reopens the conversation' }, 'another');
  result = await another.summary(input.repository);
  assert.equal(result.states[input.version][input.item].closed, false);
  await state('validated', false);
  assert.equal(
    (await another.summary(input.repository)).states[input.version][input.item].validated,
    false,
  );
  await assert.rejects(
    service.setState({
      ...input,
      item: '../../escape',
      field: 'validated',
      value: true,
      requestId: randomUUID(),
    }),
    (error) => error.status === 404,
  );
  await assert.rejects(
    service.setState({ ...input, field: 'other', value: true, requestId: randomUUID() }),
    (error) => error.status === 400,
  );
});

function fixture() {
  const data = new Map();
  const store = {
    async set(path, value) {
      data.set(path, structuredClone(value));
    },
    async remove(paths) {
      for (const path of paths) data.delete(path);
    },
    async create(path, value) {
      if (data.has(path)) return false;
      data.set(path, structuredClone(value));
      return true;
    },
    async get(path) {
      return data.get(path) ?? null;
    },
    async list(prefix) {
      return {
        blobs: [...data.keys()]
          .filter((path) => path.startsWith(prefix))
          .map((pathname) => ({
            pathname,
            url: pathname,
            uploadedAt: data.get(pathname).createdAt,
          })),
        hasMore: false,
      };
    },
  };
  const manifest = {
    'owner/app': {
      'v1.0.0': ['release', 'product-one', 'technical-one'],
      'v2.0.0': ['release', 'product-one'],
    },
  };
  const service = createDiscussionService({
    store,
    manifest,
    now: () => new Date('2026-11-15T00:00:00Z'),
  });
  const input = {
    repository: 'owner/app',
    version: 'v1.0.0',
    item: 'product-one',
    author: 'QA reviewer',
    body: 'The date changes after saving',
    kind: 'issue',
  };
  return { data, store, manifest, service, input };
}

test('reported bugs persist in the selected version with independent discussion and review state', async () => {
  const { service, input, store, manifest } = fixture();
  const report = { ...input, version: 'v2.0.0', requestId: randomUUID() };
  const [first, retry] = await Promise.all([service.report(report), service.report(report)]);
  assert.equal(first.item.id, retry.item.id);
  assert.equal(first.item.kind, 'issue');
  const other = createDiscussionService({ store, manifest });
  const shared = await other.summary(input.repository);
  assert.equal(shared.reportedItems['v1.0.0'].length, 0);
  assert.equal(shared.reportedItems['v2.0.0'].length, 1);
  assert.equal(shared.reportedItems['v2.0.0'][0].text, input.body);
  const context = { ...input, version: 'v2.0.0', item: first.item.id };
  await other.post({ ...context, body: 'Reproduzido na mesma versão' });
  assert.equal((await service.list(context)).comments[0].body, 'Reproduzido na mesma versão');
  await assert.rejects(service.list({ ...context, version: 'v1.0.0' }), (e) => e.status === 404);
  await assert.rejects(
    service.list({ ...context, item: 'reported-' + randomUUID() }),
    (e) => e.status === 404,
  );
  await other.setState({ ...context, field: 'closed', value: true, requestId: randomUUID() });
  assert.equal(
    (await service.summary(input.repository)).states['v2.0.0'][first.item.id].closed,
    true,
  );
  await assert.rejects(
    other.setState({ ...context, field: 'validated', value: true, requestId: randomUUID() }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    service.report({ ...report, body: 'Different report' }),
    (e) => e.status === 409,
  );
  await assert.rejects(service.report({ ...report, version: 'v3.0.0' }), (e) => e.status === 404);
  await assert.rejects(
    service.report({ ...report, requestId: '../escape' }),
    (e) => e.status === 400,
  );
  await assert.rejects(service.report({ ...report, body: ' ' }), (e) => e.status === 400);
});

test('shared release/item comments remain separate and survive a new service instance', async () => {
  const { store, manifest, service, input } = fixture();
  await service.post(input, 'client1');
  await service.post(
    { ...input, item: 'release', body: 'A new issue outside the listed changes' },
    'client2',
  );
  const other = createDiscussionService({ store, manifest });
  assert.equal((await other.list(input)).comments[0].body, input.body);
  assert.equal((await other.list({ ...input, item: 'release' })).comments.length, 1);
  assert.equal((await other.list({ ...input, version: 'v2.0.0' })).comments.length, 0);
  assert.equal((await other.summary('owner/app')).summary['v1.0.0']['product-one'], 1);
});

test('concurrent comments are not overwritten and retrying a request is idempotent', async () => {
  const { service, input } = fixture();
  const id = randomUUID();
  const [first, retry] = await Promise.all([
    service.post({ ...input, requestId: id }, 'one'),
    service.post({ ...input, requestId: id }, 'one'),
  ]);
  assert.equal(first.id, retry.id);
  assert.equal((await service.list(input)).total, 1);
  await assert.rejects(
    service.post({ ...input, requestId: id, body: 'Different body' }),
    (error) => error.status === 409,
  );
  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      service.post({ ...input, body: `Finding ${index}` }, `person-${index}`),
    ),
  );
  assert.equal((await service.list(input)).total, 6);
});

test('unknown apps, releases and item IDs cannot write to storage', async () => {
  const { service, input, data } = fixture();
  for (const change of [{ repository: 'other/app' }, { version: 'v9' }, { item: '../../outside' }])
    await assert.rejects(service.post({ ...input, ...change }), (error) => error.status === 404);
  assert.equal(data.size, 0);
  await assert.rejects(service.post({ ...input, author: '' }), /nome/);
  await assert.rejects(service.post({ ...input, body: 'x'.repeat(4001) }), /4 000/);
});

test('rate limit is shared across service instances and does not discard saved comments', async () => {
  const { service, input, store, manifest } = fixture();
  const create = store.create;
  let slotWrites = 0;
  store.create = async (path, value) => {
    if (path.startsWith('rate-limits/')) slotWrites++;
    return create(path, value);
  };
  for (let index = 0; index < 10; index++)
    await service.post({ ...input, body: `Message ${index}` }, 'same-client');
  assert.equal(slotWrites, 10);
  const second = createDiscussionService({
    store,
    manifest,
    now: () => new Date('2026-11-15T00:00:00Z'),
  });
  await assert.rejects(second.post(input, 'same-client'), (error) => error.status === 429);
  assert.equal(slotWrites, 10);
  assert.equal((await service.list(input)).comments.length, 10);
});

test('comment pages include every comment without cross-thread data', async () => {
  const { service, input } = fixture();
  for (let index = 0; index < 55; index++)
    await service.post({ ...input, body: `Message ${index}` }, `client-${index}`);
  const first = await service.list(input);
  const second = await service.list({ ...input, cursor: first.nextCursor });
  assert.equal(first.comments.length, 50);
  assert.equal(second.comments.length, 5);
  assert.equal(
    new Set([...first.comments, ...second.comments].map((comment) => comment.id)).size,
    55,
  );
});

test('HTTP endpoint rejects cross-origin writes and returns shared comments as inert JSON', async () => {
  const { service, input } = fixture();
  const handler = createHandler(async () => service);
  const request = (origin, body = input) =>
    new Request('https://hub.test/api/discussions', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal((await handler(request('https://other.test'))).status, 403);
  const response = await handler(
    request('https://hub.test', { ...input, body: '<script>bad()</script>' }),
  );
  assert.equal(response.status, 201);
  assert.equal((await response.json()).comment.body, '<script>bad()</script>');
  const read = await handler(
    new Request(`https://hub.test/api/discussions?${new URLSearchParams(input)}`),
  );
  assert.equal(read.headers.get('cache-control'), 'private, no-store');
  assert.equal((await read.json()).comments.length, 1);
});

test('HTTP storage failures do not reveal secrets or pretend a comment was saved', async () => {
  const handler = createHandler(async () => {
    throw new Error('private-storage-token');
  });
  const response = await handler(
    new Request('https://hub.test/api/discussions?repository=owner/app'),
  );
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.ok(!text.includes('private-storage-token'));
  assert.match(text, /rascunho não foi enviado/);
});

test('oversized requests are stopped before parsing or touching shared storage', async () => {
  let invoked = false;
  const handler = createHandler(async () => {
    invoked = true;
  });
  const response = await handler(
    new Request('https://hub.test/api/discussions', {
      method: 'POST',
      headers: { origin: 'https://hub.test', 'content-type': 'application/json' },
      body: 'x'.repeat(33000),
    }),
  );
  assert.equal(response.status, 413);
  assert.equal(invoked, false);
});

test('changelog versions and technical notes are split without inventing product changes', () => {
  const sections = changelogSections(
    '## [1.0.0] - 2026-11-01\n- Search works\n### Dependencies\n- Bump library\n## [2.0.0]\n- New screen',
  );
  assert.ok(!sections['1.0.0'].includes('New screen'));
  assert.deepEqual(technicalNotes(sections['1.0.0']), ['Bump library']);
  assert.equal(itemId('A change'), itemId('A change'));
  assert.notEqual(itemId('A change'), itemId('A change', 'technical'));
});

test('comments can be edited and deleted persistently without changing their identity or other threads', async () => {
  const { service, store, manifest, input } = fixture();
  const original = await service.post(input);
  const context = { ...input, id: original.id };
  const handler = createHandler(async () => service);
  const mutate = (action, extra = {}) =>
    handler(
      new Request('https://hub.test/api/discussions', {
        method: 'POST',
        headers: { origin: 'https://hub.test', 'content-type': 'application/json' },
        body: JSON.stringify({ ...context, action, ...extra }),
      }),
    );
  assert.equal((await mutate('edit', { body: '  Corrected finding  ' })).status, 200);
  const other = createDiscussionService({ store, manifest });
  const updated = (await other.list(input)).comments[0];
  assert.equal(updated.body, 'Corrected finding');
  assert.equal(updated.id, original.id);
  assert.equal(updated.author, original.author);
  assert.equal('participantId' in updated, false);
  assert.equal(updated.createdAt, original.createdAt);
  assert.ok(updated.updatedAt);
  assert.equal((await mutate('edit', { body: ' ' })).status, 400);
  assert.equal((await mutate('edit', { body: 'x'.repeat(4001) })).status, 400);
  assert.equal((await mutate('edit', { item: 'release', body: 'Wrong thread' })).status, 404);
  assert.equal((await mutate('delete', { item: '../../outside' })).status, 404);
  await service.post({ ...input, item: 'release', requestId: original.id });
  assert.equal((await mutate('delete')).status, 200);
  assert.equal((await other.list(input)).total, 0);
  assert.equal((await other.summary(input.repository)).summary[input.version][input.item], 0);
  assert.equal((await other.list({ ...input, item: 'release' })).total, 1);
  assert.equal((await mutate('delete')).status, 200);
  assert.equal((await mutate('edit', { body: 'Missing comment' })).status, 404);
  assert.equal((await mutate('delete', { id: '../escape' })).status, 400);
});

