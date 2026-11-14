#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const patterns = [
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.eyJ[^"'\s]*service_role/, 'Supabase service-role JWT'],
  [/sk_live_[0-9a-zA-Z]{20,}/, 'live secret key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/VAPID_PRIVATE_KEY\s*=\s*['"]?[A-Za-z0-9_-]{40,}/, 'VAPID private key'],
];

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter((f) => f && !f.endsWith('package-lock.json') && !/\.(png|jpg|webp|ico|wasm)$/.test(f));
const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const [re, label] of patterns) if (re.test(text)) hits.push(`${file}: ${label}`);
}
if (hits.length) {
  console.error(`Possible secrets committed:\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} files).`);
