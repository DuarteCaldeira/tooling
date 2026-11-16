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

test('technical changes do not accept validation and participant IDs distinguish identical names', async () => {
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
  assert.notEqual(first.participantId, second.participantId);
  await assert.rejects(
    service.post({ ...input, participantId: 'not-an-id' }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    service.post({ ...input, requestId: first.id, participantId: second.participantId }),
    (error) => error.status === 409,
  );
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
          .map((pathname) => ({ pathname, uploadedAt: data.get(pathname).createdAt })),
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
  for (let index = 0; index < 10; index++)
    await service.post({ ...input, body: `Message ${index}` }, 'same-client');
  const second = createDiscussionService({
    store,
    manifest,
    now: () => new Date('2026-11-15T00:00:00Z'),
  });
  await assert.rejects(second.post(input, 'same-client'), (error) => error.status === 429);
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
