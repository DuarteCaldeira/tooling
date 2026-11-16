import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { executable } from '../runner/execute.mjs';
import { inside, loadConfig } from '../runner/config.mjs';
import { peer, rootDirectory, writeDetails } from './shared.mjs';

export async function startServer(root, settings) {
  const cwd = inside(root, settings.cwd ?? '.');
  const command = executable(cwd, settings.command[0]);
  if (!command) throw new Error(`Missing server executable ${settings.command[0]}`);
  const child = spawn(command[0], [...command.slice(1), ...settings.command.slice(1)], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let failure,
    output = '';
  child.once('error', (error) => {
    failure = error;
  });
  child.stderr.on('data', (chunk) => {
    output = (output + chunk).slice(-4000);
  });
  const stop = async () => {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      if (child.exitCode === null)
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 5000,
        });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    if (child.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(1000, undefined, { ref: false }),
      ]);
      if (child.exitCode === null && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    }
  };
  try {
    const deadline = Date.now() + (settings.timeout ?? 30000);
    while (Date.now() < deadline) {
      if (failure || child.exitCode !== null)
        throw new Error(
          `Accessibility server did not stay running: ${failure?.message ?? (output || child.exitCode)}`,
        );
      try {
        const response = await fetch(settings.url, { signal: AbortSignal.timeout(1000) });
        if (response.ok) return stop;
      } catch {}
      await delay(100);
    }
    throw new Error(
      `Accessibility server did not become ready within ${settings.timeout ?? 30000} ms`,
    );
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function scanAccessibility(
  settings,
  { chromium, AxeBuilder, root = process.cwd(), server = startServer } = {},
) {
  if (!settings?.routes?.length) throw new Error('Configure a11y.baseURL and at least one route');
  const base = new URL(settings.baseURL);
  if (!['http:', 'https:'].includes(base.protocol))
    throw new Error('Accessibility baseURL must use HTTP or HTTPS');
  const impacts = settings.failImpacts ?? ['minor', 'moderate', 'serious', 'critical'];
  let stop, browser;
  const pages = [],
    errors = [];
  try {
    if (settings.server)
      stop = await server(root, {
        ...settings.server,
        url: settings.server.url ?? settings.baseURL,
      });
    mkdirSync(join(root, '.tooling'), { recursive: true });
    browser = await chromium.launch({
      headless: true,
      args: [`--log-file=${join(root, '.tooling/a11y-chromium.log')}`],
      ...(settings.executablePath || process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: settings.executablePath ?? process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
    });
    for (const viewport of settings.viewports ?? [{ name: 'desktop', width: 1280, height: 720 }]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        ...(settings.storageState ? { storageState: inside(root, settings.storageState) } : {}),
      });
      context.setDefaultTimeout?.(settings.timeout ?? 30000);
      try {
        for (const route of settings.routes) {
          const url = new URL(route.path, base);
          if (url.origin !== base.origin)
            throw new Error('Accessibility routes must stay on baseURL origin');
          const page = await context.newPage();
          try {
            const response = await page.goto(url.href, {
              waitUntil: 'domcontentloaded',
              timeout: settings.timeout ?? 30000,
            });
            if (response && !response.ok())
              throw new Error(`Navigation returned HTTP ${response.status()}`);
            if (new URL(page.url()).origin !== base.origin)
              throw new Error(
                'Accessibility route redirected outside baseURL origin; configure authentication state',
              );
            if (route.waitFor)
              await page.locator(route.waitFor).waitFor({ timeout: settings.timeout ?? 30000 });
            for (const action of route.actions ?? []) {
              const locator = page.locator(action.selector);
              if (action.type === 'click') await locator.click();
              else if (action.type === 'fill') await locator.fill(action.value);
              else if (action.type === 'press') await locator.press(action.value);
            }
            let axe = new AxeBuilder({ page });
            axe = axe.withTags(settings.tags ?? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
            for (const selector of route.include ?? []) axe = axe.include(selector);
            for (const selector of route.exclude ?? []) axe = axe.exclude(selector);
            const result = await axe.analyze();
            pages.push({
              route: route.name ?? route.path,
              viewport: viewport.name,
              violations: result.violations.map((violation) => ({
                id: violation.id,
                impact: violation.impact,
                help: violation.help,
                helpUrl: violation.helpUrl,
                targets: violation.nodes.flatMap((node) => node.target),
                failing: impacts.includes(violation.impact),
              })),
              incomplete: result.incomplete.map((rule) => ({ id: rule.id, help: rule.help })),
              passedRules: result.passes.length,
            });
          } catch (error) {
            errors.push({
              route: route.name ?? route.path,
              viewport: viewport.name,
              message: error.message,
            });
          } finally {
            await page.close();
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      if (stop) await stop();
    }
  }
  const failures = pages.reduce(
    (sum, page) => sum + page.violations.filter((violation) => violation.failing).length,
    0,
  );
  return { pages, errors, failures, complete: !errors.length && failures === 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = rootDirectory(),
    { config } = loadConfig(root);
  const { chromium } = peer('@playwright/test');
  const axe = peer('@axe-core/playwright');
  const result = await scanAccessibility(config.a11y, {
    root,
    chromium,
    AxeBuilder: axe.default ?? axe.AxeBuilder,
  });
  writeDetails({ a11y: result });
  for (const page of result.pages)
    for (const violation of page.violations.filter((violation) => violation.failing))
      console.error(
        `${page.route} [${page.viewport}] ${violation.impact}: ${violation.help} (${violation.id})`,
      );
  for (const error of result.errors) console.error(`${error.route}: ${error.message}`);
  console.log(
    `Accessibility: ${result.pages.length} rendered pages, ${result.failures} violations, ${result.errors.length} scan errors`,
  );
  process.exitCode = result.complete ? 0 : 1;
}
