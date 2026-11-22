import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium } from '@playwright/test';
import { itemId } from '../dashboard/release-items.mjs';

test(
  'runtime polling and tab return preserve selection, filters and conversation drafts',
  { timeout: 30_000 },
  async () => {
    const text = 'Consultas: novos lembretes antes da consulta';
    const release = {
      version: 'v1.0.0',
      releasedAt: '2026-11-17T12:00:00Z',
      items: [{ id: itemId(text), text }],
      technicalItems: [],
      notes: [text],
      source: 'published',
    };
    const snapshot = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      defaultApp: 'owner/first',
      apps: ['first', 'second'].map((name) => ({
        repository: `owner/${name}`,
        name,
        version: 'v1.0.0',
        status: 'released',
        tooling: { status: 'not-adopted' },
        releases: [release],
      })),
    };
    let fail = false;
    let requests = 0;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        reducedMotion: 'reduce',
      });
      await page.clock.install();
      // Fulfil all routes in-process so this test needs no listening network socket.
      await page.route('https://dashboard.test/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/releases') {
          requests++;
          return route.fulfill({ status: fail ? 503 : 200, json: snapshot });
        }
        if (url.pathname === '/api/discussions')
          return route.fulfill({ json: { summary: {}, states: {}, comments: [] } });
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const contentType = {
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.html': 'text/html',
        }[extname(file)];
        return route.fulfill({
          contentType,
          body: await readFile(new URL(`../dashboard/dist/${file}`, import.meta.url)),
        });
      });
      await page.goto('https://dashboard.test/?app=owner%2Fsecond');
      const trigger = page.getByRole('button', { name: `Abrir conversa: ${text}`, exact: true });
      await trigger.waitFor();
      assert.equal(await page.locator('.selected-name h2').textContent(), 'second');
      const search = page.locator('.filter-panel input').first();
      await search.fill('lembretes');
      await trigger.click();
      const draft = page.locator('textarea[name=body]');
      await draft.fill('Rascunho mantido durante a atualização');
      snapshot.apps[1].version = 'v2.0.0';
      await page.clock.fastForward(30_000);
      await page.waitForFunction(() =>
        document.querySelector('.app-choice[aria-pressed="true"]')?.textContent.includes('v2.0.0'),
      );
      assert.ok(requests >= 2);
      assert.equal(await search.inputValue(), 'lembretes');
      assert.equal(await page.locator('.selected-name h2').textContent(), 'second');
      assert.equal(await draft.inputValue(), 'Rascunho mantido durante a atualização');
      fail = true;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.locator('#release-refresh-error').waitFor();
      assert.match(
        await page.locator('.app-choice[aria-pressed="true"]').textContent(),
        /v2\.0\.0/,
      );
      assert.equal(await draft.inputValue(), 'Rascunho mantido durante a atualização');
      fail = false;
      snapshot.apps[1].version = 'v3.0.0';
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(() =>
        document.querySelector('.app-choice[aria-pressed="true"]')?.textContent.includes('v3.0.0'),
      );
      await page.locator('#release-refresh-error').waitFor({ state: 'detached' });
      assert.equal(await draft.inputValue(), 'Rascunho mantido durante a atualização');
    } finally {
      await browser.close();
    }
  },
);
