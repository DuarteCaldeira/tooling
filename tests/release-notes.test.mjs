import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collect, productNotes } from '../dashboard/collect.mjs';

test('published product notes are extracted without inventing or including technical sections', () => {
  assert.deepEqual(
    productNotes(
      '## Novidades\n- Vacinas: novos lembretes\n- Pesquisa mais rápida\n\n## Technical changes\n- Update dependencies',
    ),
    { language: 'pt-PT', changes: ['Vacinas: novos lembretes', 'Pesquisa mais rápida'] },
  );
  assert.deepEqual(productNotes('## Product updates\n- A new search screen'), {
    language: 'en',
    changes: ['A new search screen'],
  });
  assert.equal(productNotes('## Changes\n- refactor internals'), null);
  assert.equal(productNotes(null), null);
});

test('release history keeps edited notes, published product sections and raw fallback distinct', async () => {
  const config = {
    toolingRepository: 'owner/tooling',
    apps: [
      {
        name: 'App',
        repository: 'owner/app',
        releaseNotes: {
          '1.2.0': { language: 'pt-PT', changes: ['Resumo editado'] },
          '9.9.9': { language: 'pt-PT', changes: ['Not published'] },
        },
      },
    ],
  };
  const api = async (path, { optional } = {}) => {
    if (path === '/repos/owner/app') return { id: 1 };
    if (path.includes('/releases?'))
      return [
        {
          id: 3,
          tag_name: 'v1.2.0',
          published_at: '2026-11-03T00:00:00Z',
          body: 'Original technical note',
        },
        {
          id: 2,
          tag_name: 'v1.1.0',
          published_at: '2026-11-02T00:00:00Z',
          body: '## Product updates\n- New search',
        },
        {
          id: 1,
          tag_name: 'v1.0.0',
          published_at: '2026-11-01T00:00:00Z',
          body: '## Changelog\n- dependency update',
        },
        { id: 4, tag_name: 'v9.9.9', draft: true, published_at: '2027-01-01T00:00:00Z' },
      ];
    if (path.includes('/commits/')) return { sha: 'a'.repeat(40) };
    if (optional) return null;
    throw new Error(path);
  };
  const { apps } = await collect(config, api);
  const releases = apps[0].releases;
  assert.equal(releases.length, 3);
  assert.deepEqual(
    releases.map((release) => release.source),
    ['edited', 'published', 'github'],
  );
  assert.deepEqual(releases[0].notes, ['Resumo editado']);
  assert.deepEqual(releases[1].notes, ['New search']);
  assert.deepEqual(releases[2].notes, []);
  assert.equal(releases[0].originalNotes, 'Original technical note');
  assert.equal(apps[0].version, 'v1.2.0');
});

test('Saudinha preserves the supplied Portuguese summaries and SwipeIt is removed', async () => {
  const config = JSON.parse(
    await readFile(new URL('../dashboard/apps.json', import.meta.url), 'utf8'),
  );
  const notes = JSON.parse(
    await readFile(new URL('../dashboard/release-notes.json', import.meta.url), 'utf8'),
  );
  assert.equal(config.apps.length, 7);
  assert.ok(
    config.apps.some(
      (app) => app.repository === 'DuarteCaldeira/design-system' && app.emoji === '🎨',
    ),
  );
  assert.ok(config.apps.every((app) => !/swipe/i.test(app.repository)));
  assert.equal(config.apps.find((app) => app.name === 'Saudinha').tagPrefix, 'health-v');
  const saudinha = notes['DuarteCaldeira/saudinha-pnn'];
  assert.equal(Object.keys(saudinha).length, 32);
  assert.ok(saudinha['1.21.0'].changes.some((line) => line.startsWith('Vacinas:')));
  assert.ok(saudinha['1.21.1'].changes.length >= 2);
  assert.equal(Object.keys(notes['DuarteCaldeira/exercise-app']).length, 28);
  assert.equal(saudinha['1.17.1'].language, 'pt-PT');
});

test('Saudinha uses its own tags and resolves changelogs against the app version', async () => {
  const repository = 'owner/vidinha';
  const sha = 'a'.repeat(40);
  const releaseNotes = { '2.2.3': { changes: ['Resumo de Saudinha'] } };
  const releases = [
    ['v0.3.2', 'Notas de Vidinha'],
    ['meals-v2.2.5', 'Notas de Comidinha'],
    ['health-v2.2.5', '', true],
    ['health-v2.2.4', ''],
    ['health-v2.2.3', ''],
    ['health-v2.2.2', ''],
    ['health-v2.2.1', '- Corrige a pesquisa'],
  ].map(([tag_name, body, draft], index) => ({
    tag_name,
    body,
    draft,
    published_at: new Date(Date.UTC(2026, 10, 23 - index)).toISOString(),
  }));
  const file = (content) => ({
    encoding: 'base64',
    content: Buffer.from(content).toString('base64'),
  });
  const routes = {
    [`/repos/${repository}`]: { default_branch: 'main' },
    [`/repos/${repository}/releases?per_page=100&page=1`]: releases,
    [`/repos/${repository}/commits/health-v2.2.4`]: { sha },
    [`/repos/${repository}/contents/CHANGELOG.md?ref=${sha}`]: file(
      '## [2.2.4]\n- Corrige as cópias de segurança\n\n## [2.2.3]\n- Outras melhorias',
    ),
    [`/repos/${repository}/contents/CHANGELOG.md?ref=health-v2.2.2`]: file(
      '## [2.2.2]\n### Novidades\n- Novo menu',
    ),
  };
  const {
    apps: [saudinha],
  } = await collect(
    {
      toolingRepository: 'owner/tooling',
      apps: [{ name: 'Saudinha', repository, tagPrefix: 'health-v', releaseNotes }],
    },
    async (path, { optional } = {}) => {
      if (Object.hasOwn(routes, path)) return routes[path];
      if (optional) return null;
      assert.fail(`Unexpected request: ${path}`);
    },
  );
  assert.equal(saudinha.version, 'v2.2.4');
  assert.deepEqual(
    saudinha.releases.map(({ version }) => version),
    ['v2.2.4', 'v2.2.3', 'v2.2.2', 'v2.2.1'],
  );
  assert.equal(saudinha.releases[0].originalNotes, '- Corrige as cópias de segurança');
  assert.deepEqual(saudinha.releases[1].notes, ['Resumo de Saudinha']);
  assert.deepEqual(saudinha.releases[2].notes, ['Novo menu']);
  assert.equal(saudinha.releases[3].originalNotes, '- Corrige a pesquisa');
});
