import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { itemId, discussionManifest } from '../dashboard/release-items.mjs';
import { createDiscussionService, createHandler } from '../dashboard/server/discussions.mjs';

test(
  'release hub supports filters, validation, shared comment editing and accessible responsive layouts',
  { timeout: 90000 },
  async () => {
    const texts = [
      'Análises: unidade dos Leucócitos corrigida e datas certas nos gráficos',
      'Cópia de segurança: novo cartão para guardar numa pasta',
      'Perfil: escolha do grupo sanguíneo mais simples.',
    ];
    const release = (version, items = texts) => ({
      version,
      releasedAt: '2026-11-04T13:11:13Z',
      language: 'pt-PT',
      source: 'edited',
      url: 'https://github.com/owner/app/releases/tag/' + version,
      items: items.map((text) => ({ id: itemId(text), text })),
      technicalItems: [],
      originalNotes: '<script>globalThis.injected = true</script>',
    });
    const technical = release('v1.0.0', []);
    technical.technicalItems = [
      { id: itemId('chore: update dependencies', 'technical'), text: 'chore: update dependencies' },
    ];
    const fixture = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      defaultApp: 'owner/app',
      apps: [
        {
          name: 'Saudinha',
          repository: 'owner/app',
          version: 'v1.21.1',
          status: 'released',
          emoji: '🩺',
          releasedAt: '2026-11-04T13:11:13Z',
          tooling: { status: 'not-adopted' },
          releases: [
            release('v1.21.1'),
            ...Array.from({ length: 9 }, (_, i) =>
              release('v1.' + (20 - i) + '.0', ['Consultas: novos lembretes antes da consulta']),
            ),
            technical,
          ],
        },
        {
          name: 'Billy',
          repository: 'owner/billy',
          version: null,
          status: 'unreleased',
          tooling: { status: 'not-adopted' },
          releases: [],
        },
      ],
    };
    const saved = new Map();
    const store = {
      async create(path, value) {
        if (saved.has(path)) return false;
        saved.set(path, structuredClone(value));
        return true;
      },
      async set(path, value) {
        saved.set(path, structuredClone(value));
      },
      async remove(paths) {
        for (const path of paths) saved.delete(path);
      },
      async get(path) {
        return saved.get(path) ?? null;
      },
      async list(prefix) {
        return {
          blobs: [...saved.keys()]
            .filter((p) => p.startsWith(prefix))
            .map((pathname) => ({
              pathname,
              url: pathname,
              uploadedAt: saved.get(pathname).createdAt,
            })),
          hasMore: false,
        };
      },
    };
    const service = createDiscussionService({ store, manifest: discussionManifest(fixture) });
    const handler = createHandler(async () => service);
    let failWrites = false;
    const routeHandler = async (route) => {
      const original = route.request();
      const url = new URL(original.url());
      if (url.pathname === '/api/releases') return route.fulfill({ json: fixture });
      if (url.pathname === '/api/discussions') {
        if (failWrites && original.method() === 'POST')
          return route.fulfill({ status: 503, json: { error: 'Falha temporária' } });
        const response = await handler(
          new Request(original.url(), {
            method: original.method(),
            headers: await original.allHeaders(),
            ...(original.method() === 'POST' ? { body: original.postData() } : {}),
          }),
        );
        return route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        });
      }
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      return route.fulfill({
        contentType: { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' }[
          extname(file)
        ],
        body: await readFile(new URL('../dashboard/dist/' + file, import.meta.url)),
      });
    };
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1050 },
        reducedMotion: 'reduce',
      });
      await context.route('https://tooling.test/**', routeHandler);
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('https://tooling.test/');
      await page.locator('.release-area').first().waitFor();
      const select = async (id, name) => {
        await page.locator('#' + id).click();
        await page.getByRole('option', { name, exact: true }).click();
      };
      const scan = async () => {
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        assert.deepEqual(
          result.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map((node) => node.target),
          })),
          [],
        );
      };
      assert.equal(await page.locator('.release-heading').count(), 10);
      assert.equal(await page.locator('.release-area button[aria-expanded]').count(), 0);
      assert.match(
        await page.locator('.release-heading time').first().textContent(),
        /4 de novembro, 2026 13:11/,
      );
      await scan();
      await page.getByRole('button', { name: 'Mostrar versões anteriores', exact: false }).click();
      assert.equal(await page.locator('.release-heading').count(), 11);
      await select('content-filter', 'Só técnica');
      assert.equal(await page.getByRole('button', { name: /^Validar:/ }).count(), 0);
      await page.getByRole('button', { name: 'Expandir tudo', exact: true }).click();
      await page.getByText(/Detalhes técnicos/).click();
      assert.match(await page.locator('.change-copy').textContent(), /update dependencies/);
      assert.equal(await page.evaluate(() => globalThis.injected), undefined);
      await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
      await page.getByRole('button', { name: 'Filtrar por Dados', exact: true }).first().click();
      assert.match(page.url(), /topic-filter=dados/);
      assert.equal(await page.locator('.change-item').count(), 1);
      await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
      const validate = page.getByRole('button', { name: 'Validar: ' + texts[0], exact: true });
      await validate.click();
      await page
        .getByRole('button', { name: 'Retirar validação: ' + texts[0], exact: true })
        .waitFor();
      await select('review-filter', 'Por validar');
      assert.equal(await page.getByRole('button', { name: /^Retirar validação:/ }).count(), 0);
      await select('review-filter', 'Todos');
      await page.getByRole('button', { name: 'Abrir conversa: ' + texts[0], exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert.equal(await dialog.locator('#comment-author').textContent(), 'QAren');
      await dialog.getByRole('textbox', { name: /^Mensagem/ }).fill('Uma descoberta partilhada');
      await dialog.getByRole('button', { name: 'Enviar comentário', exact: true }).click();
      await dialog.getByText('Comentário enviado', { exact: true }).waitFor();
      assert.equal(await dialog.locator('.comment-mine').count(), 1);
      await scan();
      const secondContext = await browser.newContext();
      await secondContext.route('https://tooling.test/**', routeHandler);
      const other = await secondContext.newPage();
      const link =
        'https://tooling.test/?app=owner%2Fapp&release=v1.21.1&item=' +
        itemId(texts[0]) +
        '#discussion';
      await other.goto(link);
      await other.getByRole('dialog').locator('.comment').waitFor();
      assert.equal(await other.locator('.comment-mine').count(), 0);
      const comment = dialog.locator('.comment').first();
      await comment.getByRole('button', { name: 'Editar', exact: true }).click();
      await comment.getByRole('textbox', { name: 'Editar mensagem' }).fill('Descoberta corrigida');
      failWrites = true;
      await comment.getByRole('button', { name: 'Guardar', exact: true }).click();
      await dialog.getByText('Falha temporária', { exact: true }).waitFor();
      assert.equal(
        await comment.getByRole('textbox', { name: 'Editar mensagem' }).inputValue(),
        'Descoberta corrigida',
      );
      failWrites = false;
      await comment.getByRole('button', { name: 'Guardar', exact: true }).click();
      await dialog.getByText('Comentário atualizado', { exact: true }).waitFor();
      await other.getByRole('button', { name: 'Atualizar comentários', exact: true }).click();
      await other.getByText('Descoberta corrigida', { exact: true }).waitFor();
      await comment.getByRole('button', { name: 'Eliminar', exact: true }).click();
      await comment.getByRole('button', { name: 'Confirmar eliminação', exact: true }).click();
      await dialog.getByText('Comentário eliminado', { exact: true }).waitFor();
      await other.getByRole('button', { name: 'Atualizar comentários', exact: true }).click();
      await other
        .getByText('Ainda não há comentários. Comece a conversa abaixo.', { exact: true })
        .waitFor();
      await secondContext.close();
      await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await page
        .locator('#app-nav')
        .getByRole('button', { name: /^Billy/ })
        .click();
      await page
        .getByText('Ainda não há versões publicadas. As novidades vão aparecer aqui.', {
          exact: true,
        })
        .waitFor();
      await page
        .locator('#app-nav')
        .getByRole('button', { name: /^Saudinha/ })
        .click();
      await page.locator('#notes-search').fill('nothing-matches');
      await page.getByText(/Nenhuma alteração corresponde/).waitFor();
      await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
      for (const width of [1920, 1024, 390]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      await page.getByRole('button', { name: 'Abrir conversa: ' + texts[0], exact: true }).click();
      await scan();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
