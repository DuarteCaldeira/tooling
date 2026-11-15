import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const text = (value) =>
  String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll('`', '&#96;')
    .replace(/([\[\]()*_!\\])/g, '\\$1')
    .slice(0, 600);
const seconds = (value) => `${((value ?? 0) / 1000).toFixed(2)}s`;

export function markdownSummary(report, { artifactURL } = {}) {
  const lines = [
    `## Validation ${report.complete ? 'passed' : 'incomplete or failed'}`,
    '',
    `Profile: **${text(report.profile)}** · Scope: ${report.groups.map(text).join(', ')} · Duration: ${seconds(report.wallMilliseconds)}`,
    `Selected checks: **${report.results.length}** · Cache hits: **${report.results.filter((check) => check.cached).length}**`,
    '',
  ];
  if (report.affectedWorkspaces?.length)
    lines.push(`Affected workspaces: ${report.affectedWorkspaces.map(text).join(', ')}`, '');
  lines.push('| Check | Result | Reused | Time | Details |', '| --- | --- | --- | --- | --- |');
  for (const check of report.results)
    lines.push(
      `| ${text(check.id)} | ${text(check.status)} | ${check.cached ? 'yes' : 'no'} | ${seconds(check.milliseconds)} | ${text(check.reason)} |`,
    );
  const metrics = report.metrics ?? {};
  if (metrics.bundle)
    lines.push(
      '',
      `Initial JavaScript: **${Number(metrics.bundle.initialKB).toFixed(1)} KB gzip**${report.performance?.bundleDeltaKB == null ? '' : ` (${report.performance.bundleDeltaKB >= 0 ? '+' : ''}${report.performance.bundleDeltaKB.toFixed(1)} KB against the previous comparable run)`}.`,
    );
  if (metrics.coverage)
    lines.push(
      '',
      `Coverage: ${Object.entries(metrics.coverage)
        .map(([key, value]) => `${text(key)} **${value.toFixed(1)}%**`)
        .join(' · ')}.`,
    );
  if (metrics.browser)
    lines.push(
      '',
      `Browser tests: ${metrics.browser.passed} passed · ${metrics.browser.failed} failed · ${metrics.browser.flaky} flaky · ${metrics.browser.skipped} skipped.`,
    );
  if (metrics.a11y)
    lines.push(
      '',
      `Accessibility: ${metrics.a11y.pages} rendered pages · ${metrics.a11y.violations} blocking violations · ${metrics.a11y.errors} scan errors.`,
    );
  if (metrics.architecture)
    lines.push(
      '',
      `Architecture: ${metrics.architecture.files} source files · ${metrics.architecture.issues} violations.`,
    );
  if (metrics.dependencies)
    lines.push(
      '',
      `Dependencies: ${metrics.dependencies.packages} manifests · ${metrics.dependencies.issues} errors · ${metrics.dependencies.duplicates} duplicate-version notices.`,
    );
  if (report.performance?.previousMs !== null && report.performance?.previousMs !== undefined)
    lines.push(
      '',
      `Previous comparable median: ${seconds(report.performance.previousMs)}. Current change: ${report.performance.deltaMs >= 0 ? '+' : ''}${seconds(report.performance.deltaMs)}.`,
    );
  for (const regression of report.performance?.regressions ?? [])
    lines.push(
      '',
      `Slower check: **${text(regression.id)}**, ${seconds(regression.currentMs)} against ${seconds(regression.previousMs)} median.`,
    );
  if (metrics.slowTests?.length) {
    lines.push('', '### Slowest reported tests', '', '| Test | Time |', '| --- | --- |');
    for (const test of metrics.slowTests.slice(0, 10))
      lines.push(`| ${text(test.name)} | ${seconds(test.milliseconds)} |`);
  }
  const visual = report.results.filter(
    (check) =>
      (check.kind ?? check.id) === 'visual' && !['excluded', 'unavailable'].includes(check.status),
  );
  if (visual.length)
    lines.push(
      '',
      `Visual results: ${visual.map((check) => `${text(check.id)} (${text(check.status)})`).join(', ')}. Expected, actual and diff images are in the browser reports.`,
    );
  if (artifactURL) {
    const url = new URL(artifactURL);
    if (!['https:', 'http:'].includes(url.protocol))
      throw new Error('Artifact URL must use HTTP or HTTPS');
    lines.push('', `[Download validation reports and visual differences](<${url.href}>)`);
  }
  lines.push('', `Commit: ${text(report.commit)} · Tooling: ${text(report.version)}`, '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2] ?? '.tooling/report';
  const path = join(directory, 'summary.json');
  const markdown = existsSync(path)
    ? markdownSummary(JSON.parse(readFileSync(path, 'utf8')), {
        artifactURL: process.env.TOOLING_ARTIFACT_URL,
      })
    : process.env.TOOLING_EMPTY_PLAN === 'true'
      ? '## Validation passed\n\nNo checks apply to this change. Installation and validation were skipped.\n'
      : '## Validation stopped before a report was produced\n\nSee the failed workflow step for the prerequisite or planning error.\n';
  if (existsSync(directory)) writeFileSync(join(directory, 'summary.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  else console.log(markdown);
}
