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
    let pausedSummary;
    const summaryRequests = [];
    const routeHandler = async (route) => {
      const original = route.request();
      const url = new URL(original.url());
      if (url.pathname === '/api/releases') return route.fulfill({ json: fixture });
      if (url.pathname === '/api/discussions') {
        if (url.searchParams.get('view') === 'summary') {
          summaryRequests.push(url.searchParams.get('repository'));
          if (pausedSummary) await pausedSummary.promise;
        }
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
      const technicalDetails = page.getByRole('button', { name: /Detalhes técnicos/ });
      if ((await technicalDetails.getAttribute('aria-expanded')) === 'false')
        await technicalDetails.click();
      assert.match(await page.locator('.change-copy').textContent(), /update dependencies/);
      const technicalCard = page.locator('.change-item.is-technical');
      assert.equal(await technicalCard.locator('.check-wrap').count(), 0);
      await technicalCard.getByRole('button', { name: /^Abrir conversa:/ }).click();
      const technicalDialog = page.getByRole('dialog');
      await technicalDialog.getByRole('heading', { name: 'Detalhe técnico' }).waitFor();
      assert.equal(await technicalDialog.getByRole('switch', { name: 'Validada' }).count(), 0);
      await technicalDialog.getByRole('button', { name: 'Fechar', exact: true }).click();
      assert.equal(await page.evaluate(() => globalThis.injected), undefined);
      await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
      await page.getByRole('button', { name: 'Filtrar por Dados', exact: true }).first().click();
      assert.match(page.url(), /topic-filter=dados/);
      assert.equal(await page.locator('.change-item').count(), 1);
      await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
      const validate = page.getByRole('button', { name: 'Validar: ' + texts[0], exact: true });
      const summaryGate = Promise.withResolvers();
      pausedSummary = summaryGate;
      try {
        await validate.click();
        const revoke = page.getByRole('button', {
          name: 'Retirar validação: ' + texts[0],
          exact: true,
        });
        await revoke.waitFor();
        assert.equal(await revoke.isEnabled(), true);
      } finally {
        pausedSummary = undefined;
        summaryGate.resolve();
      }
      assert.ok(summaryRequests.every((repository) => repository === 'owner/app'));
      await select('review-filter', 'Por validar');
      assert.equal(await page.getByRole('button', { name: /^Retirar validação:/ }).count(), 0);
      await select('review-filter', 'Todos');
      await page.getByRole('button', { name: 'Abrir conversa: ' + texts[0], exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert.equal(await dialog.getByRole('heading', { name: 'Comentários', exact: true }).count(), 1);
      assert.equal(
        await dialog.getByRole('heading', { name: /^(Alteração|Ações|Novo comentário)$/ }).count(),
        0,
      );
      assert.equal(await dialog.locator('#comment-author').textContent(), 'QAren');
      await dialog.getByRole('textbox', { name: /^Mensagem/ }).fill('Uma descoberta partilhada');
      await dialog.getByRole('button', { name: 'Enviar comentário', exact: true }).click();
      await dialog.getByText('Comentário enviado', { exact: true }).waitFor();
      assert.equal(await dialog.locator('.comment-self').count(), 0);
      assert.equal(await dialog.getByText('Tu', { exact: true }).count(), 0);
      assert.deepEqual(
        await page.evaluate(() =>
          Object.keys(localStorage).filter((key) => key.startsWith('tooling-discussion')),
        ),
        [],
      );
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
      const confirmation = page.getByRole('dialog', { name: 'Eliminar comentário', exact: true });
      await confirmation.waitFor();
      await scan();
      failWrites = true;
      await confirmation.getByRole('button', { name: 'Eliminar comentário', exact: true }).click();
      await confirmation.getByRole('alert').getByText('Falha temporária').waitFor();
      assert.equal(
        (
          await service.list({
            repository: 'owner/app',
            version: 'v1.21.1',
            item: itemId(texts[0]),
          })
        ).total,
        1,
      );
      failWrites = false;
      await confirmation.getByRole('button', { name: 'Eliminar comentário', exact: true }).click();
      await confirmation.waitFor({ state: 'detached' });
      await dialog.getByText('Comentário eliminado', { exact: true }).waitFor();
      await other.getByRole('button', { name: 'Atualizar comentários', exact: true }).click();
      await other
        .getByText('Ainda não há comentários.', { exact: true })
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
      const conversation = page.getByRole('dialog');
      for (const [kind, message] of [
        ['Pergunta', 'Como posso reproduzir este caso?'],
        ['Problema', 'A data muda depois de guardar o registo.'],
      ]) {
        await select('comment-author', kind === 'Pergunta' ? 'DUveloper' : 'QAren');
        await select('comment-kind', kind);
        await conversation.getByRole('textbox', { name: /^Mensagem/ }).fill(message);
        await conversation.getByRole('button', { name: 'Enviar comentário', exact: true }).click();
        await conversation.getByText(message, { exact: true }).waitFor();
      }
      const question = conversation.locator('.comment-kind--question');
      const issue = conversation.locator('.comment-kind--issue');
      assert.match(await question.textContent(), /Pergunta/);
      assert.match(await issue.textContent(), /Problema/);
      assert.notEqual(
        await question.evaluate((element) => getComputedStyle(element).color),
        await issue.evaluate((element) => getComputedStyle(element).color),
      );
      assert.notEqual(
        await question.evaluate((element) => getComputedStyle(element).backgroundColor),
        await issue.evaluate((element) => getComputedStyle(element).backgroundColor),
      );
      assert.equal(await conversation.locator('.comment-actions').count(), 2);
      assert.equal(
        await conversation
          .locator('.comment-actions')
          .first()
          .evaluate((element) => getComputedStyle(element).flexDirection),
        'row',
      );
      assert.equal(await conversation.locator('.comment-qa').count(), 1);
      assert.equal(await conversation.locator('.comment:not(.comment-qa)').count(), 1);
      assert.equal(await conversation.getByText('Tu', { exact: true }).count(), 0);
      if (process.env.TOOLING_DASHBOARD_SCREENSHOTS)
        await conversation.locator('.comment-list').screenshot({
          path: process.env.TOOLING_DASHBOARD_SCREENSHOTS + '/messages.png',
        });
      await scan();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
      const selectedRelease = page.locator('.release-body').nth(1);
      await selectedRelease.getByRole('button', { name: /Reportar bug/ }).click();
      const bugDialog = page.getByRole('dialog');
      await bugDialog.getByRole('heading', { name: '🐛 Reportar bug', exact: true }).waitFor();
      assert.equal(await bugDialog.getByText('Saudinha · v1.20.0', { exact: true }).count(), 1);
      assert.equal(await bugDialog.locator('#comment-kind').textContent(), 'Problema');
      await bugDialog
        .getByRole('textbox', { name: 'Mensagem', exact: true })
        .fill('O botão de guardar não responde');
      await bugDialog.getByRole('button', { name: 'Adicionar à versão', exact: true }).click();
      await bugDialog.getByRole('heading', { name: '💬 Conversa', exact: true }).waitFor();
      await bugDialog.getByRole('heading', { name: 'Problema reportado' }).waitFor();
      assert.equal(await bugDialog.getByRole('switch', { name: 'Validada' }).count(), 0);
      assert.match(
        await bugDialog.locator('.conversation-quote').textContent(),
        /guardar não responde/,
      );
      await bugDialog.getByRole('button', { name: 'Fechar', exact: true }).click();
      await selectedRelease.getByRole('region', { name: 'Problemas reportados' }).waitFor();
      assert.equal(await selectedRelease.locator('.is-reported .check-wrap').count(), 0);
      assert.equal(
        await page
          .locator('.release-body')
          .first()
          .getByRole('region', { name: 'Problemas reportados' })
          .count(),
        0,
      );
      await page.reload();
      await page
        .getByRole('button', {
          name: 'Abrir conversa: O botão de guardar não responde',
          exact: true,
        })
        .waitFor();
      const report = (await service.summary('owner/app')).reportedItems['v1.20.0'][0];
      const linked = await context.newPage();
      await linked.goto(
        'https://tooling.test/?app=owner%2Fapp&release=v1.20.0&item=' + report.id + '#discussion',
      );
      await linked.getByRole('dialog').waitFor();
      assert.equal(
        await linked.getByRole('dialog').getByText('Saudinha · v1.20.0', { exact: true }).count(),
        1,
      );
      assert.match(
        await linked.locator('.conversation-quote').textContent(),
        /guardar não responde/,
      );
      await linked.close();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
