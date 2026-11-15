import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import { requestDeployment } from '../dashboard/refresh.mjs';

const hook = 'https://api.vercel.com/v1/integrations/deploy/prj_example/secret-hook-key';

test('Vercel release refresh requests a fresh build without returning hook credentials', async () => {
  const result = await requestDeployment(hook, async (url, options) => {
    assert.equal(new URL(url).searchParams.get('buildCache'), 'false');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ job: { id: 'job_123', state: 'PENDING' } }) };
  });
  assert.deepEqual(result, { requested: true });
  assert.ok(!JSON.stringify(result).includes('secret-hook-key'));
});

test('Vercel refresh rejects missing or unsafe hooks before sending any request', async () => {
  let calls = 0;
  for (const value of [
    undefined,
    'invalid secret-hook-key',
    'http://api.vercel.com/v1/integrations/deploy/x/y',
    'https://api.vercel.com.evil.test/v1/integrations/deploy/x/y',
    'https://user:secret@api.vercel.com/v1/integrations/deploy/x/y',
    'https://api.vercel.com/something-else',
  ]) {
    await assert.rejects(
      requestDeployment(value, async () => {
        calls++;
      }),
      (error) => !error.message.includes('secret-hook-key'),
    );
  }
  assert.equal(calls, 0);
});

test('Vercel refresh reports HTTP/network failures without leaking credential URLs', async () => {
  await assert.rejects(
    requestDeployment(hook, async () => ({ ok: false, status: 403 })),
    /403/,
  );
  await assert.rejects(
    requestDeployment(hook, async () => {
      throw new Error(hook);
    }),
    (error) => error.message === 'Vercel deployment request failed' && !error.cause,
  );
  await assert.rejects(
    requestDeployment(hook, async () => ({ ok: true, json: async () => ({}) })),
    /did not acknowledge/,
  );
});

test('Vercel build works from its project root without dependencies and publishes only static files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tooling-vercel-'));
  try {
    const source = new URL('../dashboard/', import.meta.url);
    for (const name of [
      'build.mjs',
      'collect.mjs',
      'apps.json',
      'app.js',
      'styles.css',
      'index.html',
      'vercel.json',
    ])
      await cp(new URL(name, source), join(root, name));
    const settings = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
    assert.equal(settings.buildCommand, 'node build.mjs');
    assert.equal(settings.framework, null);
    assert.equal(settings.outputDirectory, 'dist');
    const mock = `globalThis.fetch = async (url) => ({ok:true,status:200,json:async()=>String(url).includes('/releases?')?[]:{id:1}});`;
    const environment = { ...process.env, APPS_READ_TOKEN: 'fixture-only-token' };
    execFileSync(
      process.execPath,
      ['--import', `data:text/javascript,${encodeURIComponent(mock)}`, 'build.mjs'],
      { cwd: root, env: environment, stdio: 'pipe' },
    );
    const data = await readFile(join(root, 'dist/data.json'), 'utf8');
    assert.equal(JSON.parse(data).apps.length, 6);
    assert.ok(!data.includes('fixture-only-token'));
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual((await readdir(join(root, 'dist'))).sort(), [
      'app.js',
      'data.json',
      'index.html',
      'styles.css',
    ]);
    delete environment.APPS_READ_TOKEN;
    const missing = spawnSync(process.execPath, ['build.mjs'], {
      cwd: root,
      env: environment,
      encoding: 'utf8',
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Set APPS_READ_TOKEN/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release refresh keeps notification triggers and has no Pages permissions or deploy steps', async () => {
  const text = await readFile(
    new URL('../.github/workflows/apps-dashboard.yml', import.meta.url),
    'utf8',
  );
  const workflow = parseDocument(text).toJS();
  assert.deepEqual(workflow.on.repository_dispatch.types, ['app-released']);
  assert.ok(workflow.on.schedule.length);
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.permissions.pages, undefined);
  assert.ok(text.includes('secrets.VERCEL_DEPLOY_HOOK'));
  assert.ok(!text.includes('APPS_READ_TOKEN'));
  assert.ok(!text.includes('deploy-pages'));
});
