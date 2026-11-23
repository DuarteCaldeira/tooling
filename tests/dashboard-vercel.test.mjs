import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

test('Vercel data build writes only data.json; the web bundle comes from the preceding vite build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tooling-vercel-'));
  try {
    const source = new URL('../dashboard/', import.meta.url);
    for (const name of [
      'build.mjs',
      'collect.mjs',
      'release-items.mjs',
      'apps.json',
      'release-notes.json',
      'vercel.json',
    ])
      await cp(new URL(name, source), join(root, name));
    const settings = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
    assert.equal(settings.buildCommand, 'vite build');
    assert.equal(settings.functions['api/*.js'].includeFiles, '{apps.json,release-notes.json}');
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
    assert.equal(JSON.parse(data).apps.length, 7);
    assert.ok(!data.includes('fixture-only-token'));
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual((await readdir(join(root, 'dist'))).sort(), ['data.json']);
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
