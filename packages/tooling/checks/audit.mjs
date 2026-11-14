#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const audit = (...args) => {
  try {
    const out = execFileSync('npm', ['audit', '--json', ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
    return JSON.parse(out);
  } catch (error) {
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
};

const advisories = (report) => {
  const found = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {}))
    for (const via of vuln.via)
      if (typeof via === 'object' && ['high', 'critical'].includes(via.severity))
        found.set(via.url.split('/').pop(), via.name);
  return found;
};

const today = new Date().toISOString().slice(0, 10);
const allow = new Map(
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), process.env.REPO_TOOLING_AUDIT_ALLOWLIST ?? 'audit-allowlist.json'),
      'utf8',
    ),
  ).advisories.map((a) => [a.id, a]),
);

const prod = advisories(audit('--omit=dev'));
const all = advisories(audit());
const problems = [];
for (const [id, pkg] of prod) problems.push(`${id} (${pkg}) is in a production dependency`);
for (const [id, pkg] of all) {
  if (prod.has(id)) continue;
  const entry = allow.get(id);
  if (!entry) problems.push(`${id} (${pkg}) is not allowlisted`);
  else if (entry.expires < today)
    problems.push(`${id} (${pkg}) allowlist entry expired on ${entry.expires}`);
  else console.log(`allowlisted until ${entry.expires}: ${id} (${pkg}) — ${entry.reason}`);
}
for (const id of allow.keys())
  if (!all.has(id)) console.log(`note: ${id} no longer reported; remove it from the allowlist`);

if (problems.length) {
  console.error(
    `npm audit (high/critical):\n- ${problems.join('\n- ')}\nRun \`npm audit\` for details.`,
  );
  process.exit(1);
}
console.log('npm audit: no unallowlisted high or critical advisories.');
