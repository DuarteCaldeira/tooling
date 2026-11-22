import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { itemId, discussionManifest } from '../dashboard/release-items.mjs';
import { createDiscussionService, createHandler } from '../dashboard/server/discussions.mjs';

test(
  'mobile conversation actions, dismissal and page scroll work with and without animation',
  { timeout: 180000 },
  async (t) => {
    const text = 'Consultar o histórico de alterações da aplicação';
    const fixture = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      defaultApp: 'DuarteCaldeira/saudinha-pnn',
      apps: [
        {
          repository: 'DuarteCaldeira/saudinha-pnn',
          name: 'Saudinha',
          emoji: '💚',
          status: 'released',
          version: 'v1.0.0',
          releasedAt: '2026-11-16T12:00:00Z',
          tooling: { status: 'not-adopted', version: null },
          releases: [
            {
              version: 'v1.0.0',
              releasedAt: '2026-11-16T12:00:00Z',
              language: 'pt-PT',
              source: 'edited',
              notes: [],
              technicalItems: [],
              items: Array.from({ length: 24 }, (_, index) => {
                const value = index === 0 ? text : `Melhoria na aplicação número ${index}`;
                return { id: itemId(value), text: value };
              }),
            },
          ],
        },
      ],
    };
    const directory = fileURLToPath(new URL('../dashboard/dist/', import.meta.url));
    const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' };
    const origin = 'https://dashboard.test';
    const engines = { chromium, webkit };
    const selected = (process.env.TOOLING_BROWSER_ENGINES ?? 'chromium,webkit').split(',');
    for (const name of selected) assert.ok(engines[name], 'Unknown browser: ' + name);

    for (const [name, engine] of selected.map((name) => [name, engines[name]])) {
      const browser = await engine.launch({ headless: true });
      try {
        for (const reducedMotion of ['no-preference', 'reduce']) {
          await t.test(`${name}, motion: ${reducedMotion}`, async () => {
            const saved = new Map();
            const store = {
              async set(path, value) {
                saved.set(path, value);
              },
              async remove(paths) {
                for (const path of paths) saved.delete(path);
              },
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
                    .map((pathname) => ({
                      pathname,
                      url: pathname,
                      uploadedAt: saved.get(pathname).createdAt,
                    })),
                  hasMore: false,
                };
              },
            };
            const handler = createHandler(async () =>
              createDiscussionService({ store, manifest: discussionManifest(fixture) }),
            );
            const context = await browser.newContext({
              viewport: { width: 390, height: 844 },
              isMobile: true,
              hasTouch: true,
              reducedMotion,
            });
            try {
              const page = await context.newPage();
              const errors = [];
              page.on('pageerror', (error) => errors.push(error.message));
              await page.route(origin + '/**', async (route) => {
                const pathname = new URL(route.request().url()).pathname;
                const file = pathname === '/' ? 'index.html' : pathname.slice(1);
                await route.fulfill({
                  contentType: mime[extname(file)] ?? 'application/octet-stream',
                  body: await readFile(directory + '/' + file),
                });
              });
              await page.route(`${origin}/api/releases`, (route) =>
                route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) }),
              );
              await page.route(`${origin}/api/discussions**`, async (route) => {
                const original = route.request();
                const result = await handler(
                  new Request(original.url(), {
                    method: original.method(),
                    headers: await original.allHeaders(),
                    ...(original.method() === 'POST' ? { body: original.postData() } : {}),
                  }),
                );
                await route.fulfill({
                  status: result.status,
                  headers: Object.fromEntries(result.headers),
                  body: await result.text(),
                });
              });
              await page.goto(`${origin}/?app=DuarteCaldeira%2Fsaudinha-pnn`);
              const trigger = page.getByRole('button', {
                name: `Abrir conversa: ${text}`,
                exact: true,
              });
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
              const tracks = await dialog.locator('.conversation-toggle').evaluateAll((rows) =>
                rows.map((row) => {
                  const label = row.querySelector('label');
                  const track = label.querySelector('[class*="toggle-switch__track"]');
                  const bounds = row.getBoundingClientRect();
                  const toggle = track.getBoundingClientRect();
                  return {
                    right: toggle.right,
                    afterLabel: toggle.left >= label.getBoundingClientRect().right,
                    centered:
                      Math.abs(toggle.top + toggle.height / 2 - (bounds.top + bounds.height / 2)) <=
                      1,
                  };
                }),
              );
              assert.equal(tracks.length, 2);
              assert.equal(tracks[0].right, tracks[1].right);
              assert.ok(tracks.every(({ afterLabel, centered }) => afterLabel && centered));
              await page.waitForFunction(
                () => !document.getElementById('conversation-validated')?.disabled,
              );
              await dialog.getByText('Validada', { exact: true }).tap();
              await page.waitForFunction(
                () => document.getElementById('conversation-validated')?.checked,
              );
              await page.waitForFunction(
                () => !document.getElementById('conversation-resolved')?.disabled,
              );
              await dialog.getByText('Conversa resolvida', { exact: true }).tap();
              await page.waitForFunction(
                () => document.getElementById('conversation-resolved')?.checked,
              );
              await dialog
                .getByRole('button', { name: 'Atualizar comentários', exact: true })
                .tap();
              assert.equal(await dialog.locator('#comment-author').textContent(), 'QAren');
              await dialog.locator('#comment-author').tap();
              assert.equal(await page.getByRole('option').count(), 2);
              await page.getByRole('option', { name: 'DUveloper', exact: true }).tap();
              await dialog
                .getByRole('textbox', { name: /^Mensagem/ })
                .fill('Comentário enviado a partir do telemóvel.');
              await dialog.getByRole('button', { name: 'Enviar comentário', exact: true }).tap();
              await dialog.getByText('Comentário enviado', { exact: true }).waitFor();
              assert.match(await dialog.locator('.comment-list').textContent(), /DUveloper/);
              assert.equal(await dialog.locator('.comment-qa').count(), 0);
              const comment = dialog.locator('.comment-list .comment').first();
              await comment.getByRole('button', { name: 'Editar', exact: true }).tap();
              await comment
                .getByRole('textbox', { name: 'Editar mensagem' })
                .fill('Mensagem corrigida');
              await comment.getByRole('button', { name: 'Guardar', exact: true }).tap();
              await dialog.getByText('Comentário atualizado', { exact: true }).waitFor();
              assert.match(await comment.textContent(), /Mensagem corrigida/);
              await comment.getByRole('button', { name: 'Eliminar', exact: true }).tap();
              const confirmation = page.getByRole('dialog', {
                name: 'Eliminar comentário',
                exact: true,
              });
              await confirmation.waitFor();
              await page.keyboard.press('Escape');
              await confirmation.waitFor({ state: 'detached' });
              await dialog.waitFor();
              await comment.getByRole('button', { name: 'Eliminar', exact: true }).tap();
              await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).tap();
              assert.equal(await dialog.locator('.comment-list .comment').count(), 1);
              await comment.getByRole('button', { name: 'Eliminar', exact: true }).tap();
              await confirmation
                .getByRole('button', { name: 'Eliminar comentário', exact: true })
                .tap();
              await dialog.getByText('Comentário eliminado', { exact: true }).waitFor();
              await dialog
                .getByRole('button', { name: 'Atualizar comentários', exact: true })
                .tap();
              await dialog
                .getByText('Ainda não há comentários. Comece a conversa abaixo.', { exact: true })
                .waitFor();
              assert.equal(
                await page.locator('body').evaluate((body) => body.style.top),
                lockedTop,
              );
              // Resizing (e.g. the mobile keyboard) must not release the lock.
              await page.setViewportSize({ width: 390, height: 600 });
              const exit = await dialog
                .getByRole('button', { name: 'Fechar', exact: true })
                .evaluate((button) => {
                  const drawer = button.closest('[role="dialog"]');
                  button.click();
                  return {
                    animated: drawer.getAnimations().some(
                      (animation) => animation.animationName === 'conversation-exit',
                    ),
                    scrollLocked: document.body.style.position === 'fixed',
                  };
                });
              assert.equal(exit.animated, reducedMotion === 'no-preference');
              if (exit.animated) assert.equal(exit.scrollLocked, true);
              await dialog.waitFor({ state: 'detached' });
              assert.equal(await page.locator('body').evaluate((body) => body.style.position), '');
              assert.ok(
                Math.abs((await page.evaluate(() => scrollY)) + parseFloat(lockedTop)) <= 1,
              );
              assert.equal(
                await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
                `Abrir conversa: ${text}`,
              );
              await page.setViewportSize({ width: 390, height: 844 });
              await trigger.tap();
              await dialog.waitFor();
              await dialog
                .getByRole('textbox', { name: /^Mensagem/ })
                .fill('Rascunho guardado ao fechar');
              await page.keyboard.press('Escape');
              await dialog.waitFor({ state: 'detached' });
              await trigger.tap();
              await dialog.waitFor();
              assert.equal(
                await dialog.getByRole('textbox', { name: /^Mensagem/ }).inputValue(),
                'Rascunho guardado ao fechar',
              );
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
  },
);
