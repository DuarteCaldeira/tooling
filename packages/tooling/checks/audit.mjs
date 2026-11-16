#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { executable } from '../runner/execute.mjs';
import { rootDirectory, writeDetails } from './shared.mjs';

export function advisories(report) {
  if (
    !report ||
    report.error ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    Array.isArray(report.vulnerabilities)
  )
    throw new Error('npm audit did not return a valid vulnerability report');
  const found = new Map();
  for (const vuln of Object.values(report.vulnerabilities)) {
    if (!vuln || !Array.isArray(vuln.via))
      throw new Error('npm audit returned malformed vulnerability data');
    for (const via of vuln.via)
      if (via && typeof via === 'object' && ['high', 'critical'].includes(via.severity)) {
        if (typeof via.url !== 'string' || !via.url || typeof via.name !== 'string')
          throw new Error('npm audit returned malformed advisory data');
        found.set(via.url.split('/').pop(), via.name);
      }
  }
  return found;
}

export function readAllowlist(root, filename = process.env.TOOLING_AUDIT_ALLOWLIST) {
  let document;
  try {
    document = JSON.parse(
      readFileSync(resolve(root, filename ?? 'audit-allowlist.json'), 'utf8'),
    );
  } catch (error) {
    if (!filename && error.code === 'ENOENT') return new Map();
    throw error;
  }
  if (!Array.isArray(document?.advisories))
    throw new Error('Audit allowlist must contain an advisories array');
  const entries = new Map();
  for (const entry of document.advisories) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !entry.id.trim() ||
      entries.has(entry.id) ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim() ||
      typeof entry.expires !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires) ||
      !Number.isFinite(Date.parse(entry.expires)) ||
      new Date(entry.expires).toISOString().slice(0, 10) !== entry.expires
    )
      throw new Error('Audit allowlist entries need unique IDs, a reason and a valid expiry date');
    entries.set(entry.id, entry);
  }
  return entries;
}

export function evaluateAudit(
  productionReport,
  fullReport,
  allow,
  today = new Date().toISOString().slice(0, 10),
) {
  const prod = advisories(productionReport);
  const all = advisories(fullReport);
  const problems = [],
    notices = [];
  for (const [id, pkg] of prod)
    problems.push(`${id} (${pkg}) is in a production dependency`);
  for (const [id, pkg] of all) {
    if (prod.has(id)) continue;
    const entry = allow.get(id);
    if (!entry) problems.push(`${id} (${pkg}) is not allowlisted`);
    else if (entry.expires < today)
      problems.push(`${id} (${pkg}) allowlist entry expired on ${entry.expires}`);
    else notices.push(`allowlisted until ${entry.expires}: ${id} (${pkg}) — ${entry.reason}`);
  }
  for (const id of allow.keys())
    if (!all.has(id)) notices.push(`note: ${id} no longer reported; remove it from the allowlist`);
  return { problems, notices };
}

export function audit(root, ...args) {
  const command = executable(root, 'npm');
  if (!command) throw new Error('Missing npm executable');
  let output;
  try {
    output = execFileSync(command[0], [...command.slice(1), 'audit', '--json', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120000,
      shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command[0]),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (error.status !== 1 || !error.stdout) throw error;
    output = error.stdout;
  }
  const report = JSON.parse(output);
  advisories(report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = rootDirectory();
  const allow = readAllowlist(root);
  const result = evaluateAudit(audit(root, '--omit=dev'), audit(root), allow);
  writeDetails({ audit: result });
  for (const notice of result.notices) console.log(notice);
  if (result.problems.length) {
    console.error(`npm audit (high/critical):\n- ${result.problems.join('\n- ')}\nRun \`npm audit\` for details.`);
    process.exitCode = 1;
  } else console.log('npm audit: no unallowlisted high or critical advisories.');
}
