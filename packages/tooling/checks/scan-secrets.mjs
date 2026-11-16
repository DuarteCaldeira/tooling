#!/usr/bin/env node
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { git } from '../runner/git.mjs';
import { rootDirectory, writeDetails } from './shared.mjs';

const patterns = [
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/sk_live_[0-9a-zA-Z]{20,}/, 'live secret key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/VAPID_PRIVATE_KEY\s*=\s*['"]?[A-Za-z0-9_-]{40,}/, 'VAPID private key'],
];

export function secretLabels(text) {
  const labels = patterns.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]*\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') labels.push('Supabase service-role JWT');
    } catch {
      // Ordinary dotted strings and malformed tokens are not service-role JWTs.
    }
  }
  return [...new Set(labels)];
}

export function scanSecrets(root) {
  const files = [...new Set(
    git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0'),
  )].filter((file) => file && !/\.(?:png|jpe?g|gif|webp|ico|wasm|woff2?|pdf|zip)$/i.test(file));
  const hits = [];
  let scanned = 0;
  for (const file of files) {
    let text;
    try {
      const path = join(root, file);
      if (!lstatSync(path).isFile()) continue;
      text = readFileSync(path, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (text.includes('\0')) continue;
    scanned++;
    for (const label of secretLabels(text)) hits.push({ file, label });
  }
  return { scanned, hits };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = scanSecrets(rootDirectory());
  writeDetails({ secrets: result });
  if (result.hits.length) {
    console.error(`Possible secrets committed:\n${result.hits.map(({ file, label }) => `${file}: ${label}`).join('\n')}`);
    process.exitCode = 1;
  } else console.log(`Secret scan passed (${result.scanned} files).`);
}
