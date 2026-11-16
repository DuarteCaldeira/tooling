import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { itemId, discussionManifest } from '../dashboard/release-items.mjs';
import { createDiscussionService, createHandler } from '../dashboard/server/discussions.mjs';

test('mobile conversation actions, dismissal and page scroll work with and without animation', { timeout: 180000 }, async (t) => {
  const text = 'Consultar o histórico de alterações da aplicação';
  const fixture = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    defaultApp: 'DuarteCaldeira/saudinha-pnn',
    apps: [{
      repository: 'DuarteCaldeira/saudinha-pnn', name: 'Saudinha', emoji: '💚',
      status: 'released', version: 'v1.0.0', releasedAt: '2026-11-16T12:00:00Z',
      tooling: { status: 'not-adopted', version: null },
      releases: [{
        version: 'v1.0.0', releasedAt: '2026-11-16T12:00:00Z',
        language: 'pt-PT', source: 'edited', notes: [], technicalItems: [],
        items: Array.from({ length: 24 }, (_, index) => {
          const value = index === 0 ? text : `Melhoria na aplicação número ${index}`;
          return { id: itemId(value), text: value };
        }),
      }],
    }],
  };
  const directory = fileURLToPath(new URL('../dashboard/dist/', import.meta.url));
  const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' };
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      const file = resolve(directory, '.' + (path === '/' ? '/index.html' : path));
      if (!file.startsWith(directory.endsWith(sep) ? directory : directory + sep)) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const reducedMotion of ['no-preference', 'reduce']) {
        await t.test(`${name}, motion: ${reducedMotion}`, async () => {
          const saved = new Map();
          const store = {
            async create(path, value) {
              if (saved.has(path)) return false;
              saved.set(path, value);
              return true;
            },
            async get(path) { return saved.get(path) ?? null; },
            async list(prefix) {
              return {
                blobs: [...saved.keys()].filter((path) => path.startsWith(prefix))
                  .map((pathname) => ({ pathname, uploadedAt: saved.get(pathname).createdAt })),
                hasMore: false,
              };
            },
          };
          const handler = createHandler(async () =>
            createDiscussionService({ store, manifest: discussionManifest(fixture) }),
          );
          const context = await browser.newContext({
            viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion,
          });
          try {
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.route(`${origin}/data.json`, (route) =>
              route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) }),
            );
            await page.route(`${origin}/api/discussions**`, async (route) => {
              const original = route.request();
              const result = await handler(new Request(original.url(), {
                method: original.method(), headers: await original.allHeaders(),
                ...(original.method() === 'POST' ? { body: original.postData() } : {}),
              }));
              await route.fulfill({
                status: result.status, headers: Object.fromEntries(result.headers),
                body: await result.text(),
              });
            });
            await page.goto(origin);
            const trigger = page.getByRole('button', { name: `Abrir conversa: ${text}`, exact: true });
            await trigger.waitFor();
            await trigger.scrollIntoViewIfNeeded();
            await trigger.focus();
            await trigger.tap();
            const dialog = page.getByRole('dialog');
            await dialog.waitFor();
            await page.waitForFunction(() => document.body.style.position === 'fixed');
            const lockedTop = await page.locator('body').evaluate((body) => body.style.top);
            const validated = dialog.getByRole('switch', { name: 'Validada', exact: true });
            await validated.waitFor({ state: 'attached' });
            await page.waitForFunction(() => !document.getElementById('conversation-validated')?.disabled);
            await dialog.getByText('Validada', { exact: true }).tap();
            await page.waitForFunction(() => document.getElementById('conversation-validated')?.checked);
            await page.waitForFunction(() => !document.getElementById('conversation-resolved')?.disabled);
            await dialog.getByText('Conversa resolvida', { exact: true }).tap();
            await page.waitForFunction(() => document.getElementById('conversation-resolved')?.checked);
            await dialog.getByRole('button', { name: 'Atualizar comentários', exact: true }).tap();
            await dialog.getByRole('textbox', { name: /^Nome/ }).fill('Mobile reviewer');
            await dialog.getByRole('textbox', { name: /^Mensagem/ }).fill('Comentário enviado a partir do telemóvel.');
            await dialog.getByRole('button', { name: 'Enviar comentário', exact: true }).tap();
            await dialog.getByText('Comentário enviado', { exact: true }).waitFor();
            assert.match(await dialog.locator('.comment-list').textContent(), /Mobile reviewer/);
            assert.equal(await page.locator('body').evaluate((body) => body.style.top), lockedTop);
            // Resizing (e.g. the mobile keyboard) must not release the lock.
            await page.setViewportSize({ width: 390, height: 600 });
            await dialog.getByRole('button', { name: 'Fechar', exact: true }).tap();
            await dialog.waitFor({ state: 'detached' });
            assert.equal(await page.locator('body').evaluate((body) => body.style.position), '');
            assert.ok(Math.abs(await page.evaluate(() => scrollY) + parseFloat(lockedTop)) <= 1);
            assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
              `Abrir conversa: ${text}`);
            await page.setViewportSize({ width: 390, height: 844 });
            await trigger.tap();
            await dialog.waitFor();
            await dialog.getByRole('textbox', { name: /^Mensagem/ }).fill('Rascunho guardado ao fechar');
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'detached' });
            await trigger.tap();
            await dialog.waitFor();
            assert.equal(await dialog.getByRole('textbox', { name: /^Mensagem/ }).inputValue(),
              'Rascunho guardado ao fechar');
            await dialog.getByRole('button', { name: 'Fechar', exact: true }).tap();
            await dialog.waitFor({ state: 'detached' });
            const before = await page.evaluate(() => scrollY);
            await page.evaluate(() => scrollBy({ top: 150, behavior: 'instant' }));
            assert.notEqual(await page.evaluate(() => scrollY), before);
            await page.setViewportSize({ width: 768, height: 1024 });
            await trigger.tap();
            await dialog.waitFor();
            await page.mouse.click(16, 80);
            await dialog.waitFor({ state: 'detached' });
            assert.equal(await page.locator('body').evaluate((body) => body.style.position), '');
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        });
      }
    } finally {
      await browser.close();
    }
  }
});
