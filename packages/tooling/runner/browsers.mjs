import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { executable, invoke, packageManifest } from './execute.mjs';
import { inside } from './config.mjs';

export function browserChecks(selection) {
  return selection.checks.filter(
    (check) =>
      !check.excluded && ['e2e', 'visual', 'a11y', 'lighthouse'].includes(check.kind ?? check.id),
  );
}

export async function provisionBrowsers(
  root,
  selection,
  {
    run = invoke,
    find = executable,
    manifest = packageManifest,
    load = (path) => createRequire(path)('@playwright/test'),
    env = process.env,
  } = {},
) {
  const checks = browserChecks(selection);
  if (!checks.length) return {};
  const installed = new Set();
  let playwrightChrome;
  for (const check of checks.filter((check) =>
    ['e2e', 'visual', 'a11y'].includes(check.kind ?? check.id),
  )) {
    const cwd = inside(root, check.cwd ?? '.');
    const packagePath = manifest(cwd, '@playwright/test');
    if (!packagePath)
      throw new Error(`${check.id}: install a locked @playwright/test in ${check.cwd ?? '.'}`);
    if (!installed.has(packagePath)) {
      const result = await run(['playwright', 'install', '--with-deps', 'chromium'], root, { cwd });
      if (result.status !== 'passed') throw new Error(`${check.id}: Chromium installation failed`);
      installed.add(packagePath);
    }
    playwrightChrome = load(packagePath).chromium.executablePath();
  }
  if (!checks.some((check) => (check.kind ?? check.id) === 'lighthouse')) return {};
  // Lighthouse-only projects can use the runner's native Chrome without installing Playwright.
  const native =
    env.CHROME_PATH ||
    ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
      .map((name) => find(root, name)?.[0])
      .find(Boolean);
  if (native) return { CHROME_PATH: native };
  if (playwrightChrome) return { CHROME_PATH: playwrightChrome };
  const cwd = inside(
    root,
    checks.find((check) => (check.kind ?? check.id) === 'lighthouse').cwd ?? '.',
  );
  const packagePath = manifest(cwd, '@playwright/test');
  if (!packagePath)
    throw new Error(
      'Lighthouse requires CHROME_PATH, a native Chrome installation, or locked @playwright/test for Chromium provisioning',
    );
  const result = await run(['playwright', 'install', '--with-deps', 'chromium'], root, { cwd });
  if (result.status !== 'passed') throw new Error('Lighthouse Chromium installation failed');
  return { CHROME_PATH: load(packagePath).chromium.executablePath() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const selection = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const variables = await provisionBrowsers(process.cwd(), selection);
  for (const [key, value] of Object.entries(variables)) {
    if (/[\r\n]/.test(value)) throw new Error(`Invalid ${key}`);
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${key}=${value}\n`);
  }
}
