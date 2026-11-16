import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { itemId, discussionManifest } from '../dashboard/release-items.mjs';
import { createDiscussionService, createHandler } from '../dashboard/server/discussions.mjs';

test(
  'release hub supports product reading, app selection, search, filters and accessible mobile layouts',
  { timeout: 60000 },
  async () => {
    const source = new URL('../dashboard/', import.meta.url);
    const config = JSON.parse(await readFile(new URL('apps.json', source), 'utf8'));
    const notes = JSON.parse(await readFile(new URL('release-notes.json', source), 'utf8'));
    const fixture = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      defaultApp: config.defaultApp,
      apps: config.apps.map((app) => ({
        ...app,
        status: app.name === 'Saudinha' || app.name === 'Rookie' ? 'released' : 'unreleased',
        repositoryUrl: `https://github.com/${app.repository}`,
        version: app.name === 'Saudinha' ? 'v1.21.1' : app.name === 'Rookie' ? 'v1.27.1' : null,
        releasedAt:
          app.name === 'Saudinha' || app.name === 'Rookie' ? '2026-11-04T13:11:13Z' : null,
        tooling: { status: 'not-adopted', version: null },
        releases: Object.entries(notes[app.repository] ?? {})
          .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
          .slice(0, 10)
          .map(([version, note]) => ({
            version: `v${version}`,
            releasedAt: '2026-11-04T13:11:13Z',
            notes: note.changes,
            language: note.language,
            source: 'edited',
            originalNotes: '',
            items: note.changes.map((text, index) => ({
              id: note.itemIds?.[index] ?? itemId(text),
              text,
            })),
            technicalItems: [],
            url: `https://github.com/${app.repository}/releases/tag/v${version}`,
          })),
      })),
    };
    const saudinha = fixture.apps.find((app) => app.name === 'Saudinha');
    saudinha.releases.push({
      version: 'v1.0.0',
      releasedAt: '2026-01-01T00:00:00Z',
      notes: [],
      items: [],
      technicalItems: [
        {
          id: itemId('Dependências: bibliotecas atualizadas.', 'technical'),
          text: 'Dependências: bibliotecas atualizadas.',
        },
      ],
      source: 'github',
      originalNotes: '<script>globalThis.injected = true</script>',
      url: 'https://github.com/DuarteCaldeira/saudinha-pnn/releases/tag/v1.0.0',
    });
    const files = { '/data.json': JSON.stringify(fixture) };
    for (const name of ['index.html', 'styles.css', 'discussions.css', 'app.js', 'discussions.js'])
      files[`/${name}`] = await readFile(new URL(name, source), 'utf8');
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.TOOLING_BROWSER_CHANNEL
        ? { channel: process.env.TOOLING_BROWSER_CHANNEL }
        : {}),
    });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
      const page = await context.newPage();
      const saved = new Map();
      const store = {
        async create(path, value) {
          if (saved.has(path)) return false;
          saved.set(path, value);
          return true;
        },
        async get(path) {
          return saved.get(path) ?? null;
        },
        async list(prefix) {
          return {
            blobs: [...saved.keys()]
              .filter((path) => path.startsWith(prefix))
              .map((pathname) => ({ pathname, uploadedAt: saved.get(pathname).createdAt })),
            hasMore: false,
          };
        },
      };
      const handler = createHandler(async () =>
        createDiscussionService({ store, manifest: discussionManifest(fixture) }),
      );
      const routeHandler = async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/discussions') {
          const original = route.request();
          const response = await handler(
            new Request(original.url(), {
              method: original.method(),
              headers: await original.allHeaders(),
              ...(original.method() === 'POST' ? { body: original.postData() } : {}),
            }),
          );
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: await response.text(),
          });
          return;
        }
        const file = path === '/' ? '/index.html' : path;
        await route.fulfill({
          status: files[file] ? 200 : 404,
          contentType: file.endsWith('.js')
            ? 'application/javascript'
            : file.endsWith('.css')
              ? 'text/css'
              : file.endsWith('.json')
                ? 'application/json'
                : 'text/html',
          body: files[file] ?? 'Not found',
        });
      };
      await context.route('https://tooling.test/**', routeHandler);
      await page.goto('https://tooling.test/');
      await page.waitForSelector('.release-entry');
      assert.equal(await page.locator('#total').textContent(), '6');
      assert.equal(await page.locator('#release-app').inputValue(), saudinha.repository);
      assert.equal(await page.locator('.release-entry').count(), 10);
      assert.match(
        await page.locator('.release-entry').first().textContent(),
        /unidade dos Leucócitos/,
      );
      assert.equal(await page.locator('.change-list').first().getAttribute('lang'), 'pt-PT');
      assert.equal(await page.locator('#release-app option').count(), 6);
      assert.equal(await page.locator('.release-icon').first().textContent(), '🚀');
      assert.equal(await page.locator('#selected-emoji').textContent(), '💚');
      assert.ok(
        !(await page
          .locator('body')
          .textContent()
          .then((text) => /swipeit/i.test(text))),
      );
      const scan = async () => {
        const report = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        assert.deepEqual(
          report.violations.map(({ id, nodes }) => ({
            id,
            nodes: nodes.map((node) => node.target),
          })),
          [],
        );
      };
      await scan();
      if (process.env.TOOLING_DASHBOARD_SCREENSHOTS) {
        await mkdir(process.env.TOOLING_DASHBOARD_SCREENSHOTS, { recursive: true });
        await page.screenshot({
          path: join(process.env.TOOLING_DASHBOARD_SCREENSHOTS, 'dashboard-desktop.png'),
        });
      }
      await page.locator('#load-more').click();
      assert.equal(await page.locator('.release-entry').count(), 11);
      assert.equal(
        await page.locator('.release-entry').first().locator('.technical-notes').count(),
        0,
      );
      assert.equal(await page.locator('.technical-notes').last().getAttribute('open'), null);
      await page.locator('.release-entry').last().locator(':scope > summary').click();
      await page.locator('.technical-notes').last().locator(':scope > summary').click();
      assert.equal(await page.locator('.technical-list .validation-button').count(), 0);
      assert.equal(await page.locator('.original-notes').count(), 0);
      assert.equal(await page.getByText('Read original changelog').count(), 0);
      assert.equal(await page.locator('html').getAttribute('lang'), 'pt-PT');
      assert.equal(
        await page.locator('.release-heading time').first().textContent(),
        '4 de novembro, 2026 13:11',
      );
      assert.ok(
        (await page
          .locator('.change-copy')
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 16,
      );
      const originalTotal = await page.locator('.change-item').count();
      await page.locator('.validation-button').first().click();
      await page.locator('.validation-button[aria-pressed="true"]').waitFor();
      await page.locator('#review-filter').selectOption('pending');
      assert.equal(await page.locator('.validation-button[aria-pressed="true"]').count(), 0);
      assert.ok((await page.locator('.change-item').count()) < originalTotal);
      await page.locator('#review-filter').selectOption('all');
      assert.equal(await page.evaluate(() => globalThis.injected), undefined);
      await page
        .locator('.release-entry')
        .first()
        .locator('.change-list .item-trigger')
        .first()
        .click();
      await page.locator('input[name="author"]').fill('QA reviewer');
      await page.locator('select[name="kind"]').selectOption('issue');
      await page
        .locator('textarea[name="body"]')
        .fill('The imported date changes after saving. Expected the original day.');
      await page.locator('.submit-comment').click();
      await page.getByText('Comentário enviado', { exact: true }).waitFor();
      assert.match(await page.locator('.comment-list').textContent(), /QA reviewer/);
      assert.equal(await page.locator('.comment-mine .comment-self').textContent(), 'Tu');
      const link = await page.locator('.discussion-toolbar a').getAttribute('href');
      const another = await context.newPage();
      await another.goto(link);
      await another.locator('.comment-list .comment').waitFor();
      assert.match(await another.locator('.comment-list').textContent(), /imported date changes/);
      assert.equal(await another.locator('.validation-button[aria-pressed="true"]').count(), 1);
      assert.equal(await another.locator('.comment-mine').count(), 1);
      await another.close();
      const otherContext = await browser.newContext();
      await otherContext.route('https://tooling.test/**', routeHandler);
      const otherPerson = await otherContext.newPage();
      await otherPerson.goto(link);
      await otherPerson.locator('.comment-list .comment').waitFor();
      assert.equal(await otherPerson.locator('.comment-mine').count(), 0);
      await otherPerson.locator('input[name="author"]').fill('QA reviewer');
      await otherPerson
        .locator('textarea[name="body"]')
        .fill('Another person with the same display name.');
      await otherPerson.locator('.submit-comment').click();
      await otherPerson.getByText('Comentário enviado', { exact: true }).waitFor();
      assert.equal(await otherPerson.locator('.comment-mine').count(), 1);
      assert.equal(await otherPerson.locator('.comment-other').count(), 1);
      await otherContext.close();
      await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
      await page.locator('.comment-other').waitFor();
      assert.equal(await page.locator('.comment-mine').count(), 1);
      await scan();
      await page.getByRole('button', { name: 'Marcar como resolvida', exact: true }).click();
      await page.getByText('Conversa resolvida', { exact: true }).waitFor();
      await page.locator('.discussion-heading button').click();
      await page.locator('#discussion-filter').selectOption('open');
      assert.equal(await page.locator('.release-entry').count(), 0);
      await page.locator('#discussion-filter').selectOption('all');
      await page.locator('.item-trigger').first().click();
      await page.getByRole('button', { name: 'Reabrir conversa', exact: true }).click();
      await page.getByText('Conversa reaberta', { exact: true }).waitFor();
      await page.locator('.discussion-heading button').click();
      await page.locator('#discussion-filter').selectOption('open');
      assert.equal(await page.locator('.release-entry').count(), 1);
      assert.equal(await page.locator('.change-item').count(), 1);
      await page.locator('#review-filter').selectOption('pending');
      assert.equal(await page.locator('.release-entry').count(), 0);
      await page.locator('#review-filter').selectOption('validated');
      assert.equal(await page.locator('.change-item').count(), 1);
      await page.locator('#clear-filters').click();
      await page.locator('#content-filter').selectOption('product');
      assert.equal(await page.locator('.release-entry').count(), 10);
      await page.locator('#notes-search').fill('copia seguranca');
      assert.ok((await page.locator('.change-item').count()) > 0);
      await page.locator('#clear-filters').click();
      const firstRelease = page.locator('.release-entry').first();
      const remaining = await firstRelease
        .locator('.validation-button[aria-pressed="false"]')
        .count();
      for (let index = 0; index < remaining; index++) {
        const before = await firstRelease
          .locator('.validation-button[aria-pressed="false"]')
          .count();
        await firstRelease.locator('.validation-button[aria-pressed="false"]').first().click();
        await page.waitForFunction(
          (count) =>
            document
              .querySelector('.release-entry')
              .querySelectorAll('.validation-button[aria-pressed="false"]').length < count,
          before,
        );
      }
      await page.waitForFunction(() => !document.querySelector('.release-entry').open);
      assert.match(await firstRelease.locator(':scope > summary').textContent(), /Tudo validado/);
      const reopened = await context.newPage();
      await reopened.goto('https://tooling.test/');
      await reopened.waitForFunction(
        () =>
          document.querySelector('.release-entry.release-complete') &&
          !document.querySelector('.release-entry').open,
      );
      await reopened.close();
      await firstRelease.locator(':scope > summary').click();
      await page.locator('#refresh-review').click();
      assert.equal(await firstRelease.evaluate((el) => el.open), true);
      await firstRelease.locator('.validation-button[aria-pressed="true"]').first().click();
      await firstRelease.locator('.validation-button[aria-pressed="false"]').waitFor();
      await page.locator('#collapse-all').click();
      assert.equal(await page.locator('.release-entry[open]').count(), 0);
      await page.locator('#expand-all').click();
      assert.equal(
        await page.locator('.release-entry[open]').count(),
        await page.locator('.release-entry').count(),
      );
      await page.locator('#content-filter').selectOption('product');
      await page.locator('#notes-search').fill('Vacinas');
      assert.equal(await page.locator('.release-entry').count(), 1);
      await page.locator('#notes-search').fill('nothing-matches');
      assert.equal(await page.locator('.release-entry').count(), 0);
      assert.match(
        await page.locator('#notes-message').textContent(),
        /Nenhuma alteração corresponde/,
      );
      await page.locator('#release-app').selectOption('DuarteCaldeira/billy');
      assert.match(
        await page.locator('#notes-message').textContent(),
        /Ainda não há versões publicadas/,
      );
      assert.match(page.url(), /app=DuarteCaldeira%2Fbilly/);
      assert.match(
        await page.locator('#share-app').getAttribute('href'),
        /app=DuarteCaldeira%2Fbilly/,
      );
      await page.locator('#release-app').selectOption(saudinha.repository);
      await page.locator('[data-app="DuarteCaldeira/design-system"]').click();
      assert.equal(await page.locator('#selected-emoji').textContent(), '🎨');
      assert.equal(await page.locator('#release-app').inputValue(), 'DuarteCaldeira/design-system');
      await page.locator('[data-app="DuarteCaldeira/saudinha-pnn"]').click();
      await page.locator('#apps > summary').click();
      assert.equal(await page.locator('.app-card').count(), 6);
      await page.locator('[data-filter="released"]').click();
      assert.equal(await page.locator('.app-card').count(), 2);
      await page.locator('[data-filter="unreleased"]').click();
      assert.equal(await page.locator('.app-card').count(), 4);
      await page.locator('[data-filter="all"]').click();
      await page.locator('#search').fill('Rookie');
      assert.equal(await page.locator('.app-card').count(), 1);
      await page.locator('#search').fill('');
      await page.locator('#sort').selectOption('name');
      assert.match(await page.locator('.app-card').first().textContent(), /Billy/);
      await page.locator('#apps > summary').click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.locator('.item-trigger').first().click();
      await scan();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.locator('.discussion-heading button').click();
      if (process.env.TOOLING_DASHBOARD_SCREENSHOTS)
        await page.screenshot({
          path: join(process.env.TOOLING_DASHBOARD_SCREENSHOTS, 'dashboard-mobile.png'),
        });
    } finally {
      await browser.close();
    }
  },
);
