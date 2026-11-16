import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { build, createClient } from './collect.mjs';
import { discussionManifest } from './release-items.mjs';

if (!process.env.APPS_READ_TOKEN)
  throw new Error('Set APPS_READ_TOKEN in the Vercel project environment before building');

const snapshot = await build({
  configPath: new URL('./apps.json', import.meta.url),
  output: fileURLToPath(new URL('./dist/', import.meta.url)),
  api: createClient(process.env.APPS_READ_TOKEN),
});
console.log(`Built release dashboard for ${snapshot.apps.length} apps`);
await mkdir(new URL('./server/', import.meta.url), { recursive: true });
await writeFile(
  new URL('./server/discussion-manifest.json', import.meta.url),
  JSON.stringify(discussionManifest(snapshot)),
);

if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
  const { randomUUID } = await import('node:crypto');
  const { put, get, del } = await import('@vercel/blob');
  const path = `diagnostics/build-${randomUUID()}.json`;
  const blob = await put(path, JSON.stringify({ check: 'discussion-storage' }), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  try {
    const file = await get(path, { access: 'private', useCache: false });
    if (
      !file ||
      file.statusCode !== 200 ||
      (await new Response(file.stream).json()).check !== 'discussion-storage'
    )
      throw new Error('Shared discussion storage check failed');
    let rejectedOverwrite = false;
    try {
      await put(path, '{}', { access: 'private', addRandomSuffix: false, allowOverwrite: false });
    } catch (error) {
      if (await get(path, { access: 'private', useCache: false })) rejectedOverwrite = true;
      else throw error;
    }
    if (!rejectedOverwrite) throw new Error('Storage must reject overwriting existing comments');
    console.log('Private discussion storage write/read/concurrency checks passed');
  } finally {
    await del(blob.url);
  }
}
