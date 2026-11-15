import { fileURLToPath } from 'node:url';
import { build, createClient } from './collect.mjs';

if (!process.env.APPS_READ_TOKEN)
  throw new Error('Set APPS_READ_TOKEN in the Vercel project environment before building');

const snapshot = await build({
  configPath: new URL('./apps.json', import.meta.url),
  output: fileURLToPath(new URL('./dist/', import.meta.url)),
  api: createClient(process.env.APPS_READ_TOKEN),
});
console.log(`Built release dashboard for ${snapshot.apps.length} apps`);
