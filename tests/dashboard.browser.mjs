import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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
          .reverse()
          .map(([version, note]) => ({
            version: `v${version}`,
            releasedAt: '2026-11-04T13:11:13Z',
            notes: note.changes,
            language: note.language,
            source: 'edited',
            originalNotes: '',
            url: `https://github.com/${app.repository}/releases/tag/v${version}`,
          })),
      })),
    };
    const saudinha = fixture.apps.find((app) => app.name === 'Saudinha');
    saudinha.releases.push({
      version: 'v1.0.0',
      releasedAt: '2026-01-01T00:00:00Z',
      notes: [],
      source: 'github',
      originalNotes: '<script>globalThis.injected = true</script>',
      url: 'https://github.com/DuarteCaldeira/saudinha-pnn/releases/tag/v1.0.0',
    });
    const files = { '/data.json': JSON.stringify(fixture) };
    for (const name of ['index.html', 'styles.css', 'app.js'])
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
      await page.route('https://tooling.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
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
      });
      await page.goto('https://tooling.test/');
      await page.waitForSelector('.release-entry');
      assert.equal(await page.locator('#total').textContent(), '5');
      assert.equal(await page.locator('#release-app').inputValue(), saudinha.repository);
      assert.equal(await page.locator('.release-entry').count(), 10);
      assert.match(
        await page.locator('.release-entry').first().textContent(),
        /unidade dos Leucócitos/,
      );
      assert.equal(await page.locator('.change-list').first().getAttribute('lang'), 'pt-PT');
      assert.equal(await page.locator('#release-app option').count(), 5);
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
      await page.locator('.original-notes summary').click();
      assert.match(await page.locator('.original-notes pre').textContent(), /<script>/);
      assert.equal(await page.evaluate(() => globalThis.injected), undefined);
      await page.locator('#product-only').check();
      assert.equal(await page.locator('.release-entry').count(), 10);
      await page.locator('#notes-search').fill('Vacinas');
      assert.equal(await page.locator('.release-entry').count(), 1);
      await page.locator('#notes-search').fill('nothing-matches');
      assert.equal(await page.locator('.release-entry').count(), 0);
      assert.match(await page.locator('#notes-message').textContent(), /No releases match/);
      await page.locator('#release-app').selectOption('DuarteCaldeira/billy');
      assert.match(await page.locator('#notes-message').textContent(), /No published releases yet/);
      assert.match(page.url(), /app=DuarteCaldeira%2Fbilly/);
      assert.match(
        await page.locator('#share-app').getAttribute('href'),
        /app=DuarteCaldeira%2Fbilly/,
      );
      await page.locator('#release-app').selectOption(saudinha.repository);
      await page.locator('#apps > summary').click();
      assert.equal(await page.locator('.app-card').count(), 5);
      await page.locator('[data-filter="released"]').click();
      assert.equal(await page.locator('.app-card').count(), 2);
      await page.locator('[data-filter="unreleased"]').click();
      assert.equal(await page.locator('.app-card').count(), 3);
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
      await scan();
      if (process.env.TOOLING_DASHBOARD_SCREENSHOTS)
        await page.screenshot({
          path: join(process.env.TOOLING_DASHBOARD_SCREENSHOTS, 'dashboard-mobile.png'),
        });
    } finally {
      await browser.close();
    }
  },
);
