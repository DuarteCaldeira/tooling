import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownSummary } from './summary.mjs';

const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function writeReport(directory, report) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(directory, 'summary.md'), markdownSummary(report));
  const rows = report.results
    .map(
      (r) =>
        `<tr><td>${escape(r.id)}</td><td>${escape(r.status)}</td><td>${escape(r.reason)}</td><td>${((r.milliseconds ?? 0) / 1000).toFixed(2)}s</td></tr>`,
    )
    .join('');
  const browserLinks = report.results
    .filter(
      (result) =>
        ['e2e', 'visual'].includes(result.kind ?? result.id) &&
        existsSync(join(directory, result.id, 'index.html')),
    )
    .map(
      (result) =>
        `<a href="${encodeURIComponent(result.id)}/index.html">${escape(result.id)} report</a>`,
    )
    .join(' &middot; ');
  writeFileSync(
    join(directory, 'index.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Repository checks</title><style>body{font:16px system-ui;max-width:1100px;margin:3rem auto;padding:0 1rem;color:#172033}table{width:100%;border-collapse:collapse}td,th{padding:.8rem;text-align:left;border-bottom:1px solid #ccd3df}code{overflow-wrap:anywhere}</style><h1>${report.complete ? 'Validation passed' : 'Validation incomplete or failed'}</h1><p>${escape(report.profile)} &middot; ${escape(report.groups.join(', '))}</p><p>Commit: <code>${escape(report.commit)}</code></p><p>Tooling: ${escape(report.version)}</p><table><thead><tr><th>Check</th><th>Result</th><th>Details</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table><p><a href="summary.json" download>Download JSON</a>${browserLinks ? ` &middot; ${browserLinks}` : ''}</p></html>`,
  );
}
