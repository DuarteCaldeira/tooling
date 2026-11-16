import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { scanAccessibility } from '../packages/tooling/checks/a11y.mjs';

test(
  'real Chromium and axe pass accessible content and reject an unnamed button',
  { timeout: 60000, skip: process.env.TOOLING_SKIP_NETWORK_TESTS === '1' },
  async () => {
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en"><head><title>Accessibility fixture</title></head><body><main><h1>Profile</h1><button>${request.url === '/bad' ? '' : 'Save profile'}</button></main></body></html>`,
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    try {
      const good = await scanAccessibility(
        { baseURL, routes: [{ path: '/good' }] },
        { chromium, AxeBuilder },
      );
      assert.equal(good.complete, true, JSON.stringify(good));
      const bad = await scanAccessibility(
        { baseURL, routes: [{ path: '/bad' }] },
        { chromium, AxeBuilder },
      );
      assert.equal(bad.complete, false);
      assert.ok(bad.pages[0].violations.some((violation) => violation.id === 'button-name'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test('axe inspects real rendered DOM without network access', { timeout: 60000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tooling-browser-'));
  const browser = await chromium.launch({
    headless: true,
    args: [`--log-file=${join(directory, 'debug.log')}`],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>Profile</title></head><body><main><h1>Profile</h1><button>Save profile</button></main></body></html>',
    );
    const good = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    assert.deepEqual(good.violations, []);
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>Profile</title></head><body><main><h1>Profile</h1><button></button></main></body></html>',
    );
    const bad = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    assert.ok(bad.violations.some((violation) => violation.id === 'button-name'));
    await context.close();
  } finally {
    await browser.close();
  }
});
