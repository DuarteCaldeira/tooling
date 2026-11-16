import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const cell = (text) => String(text).replaceAll('|', '&#124;').replace(/[\r\n]+/g, ' ');

export function playwrightSummary(data, { artifact = 'visual-diffs', report = 'playwright-report/index.html' } = {}) {
  const failures = [];

const collect = (suite, path = []) => {
  const titles = suite.title ? [...path, suite.title] : path;

  for (const spec of suite.specs ?? []) {
    if (spec.ok) continue;
    const projects = [
      ...new Set((spec.tests ?? []).map((test) => test.projectName)),
    ];
    failures.push({
      name: [...titles, spec.title].join(' › '),
      projects: projects.join(', '),
    });
  }
  for (const child of suite.suites ?? []) collect(child, titles);
};

for (const suite of data.suites ?? [])
  collect(suite);

if (failures.length === 0) return '';

const rows = failures
  .map(({ name, projects }) => `| ${cell(name)} | ${cell(projects)} |`)
  .join('\n');

return [
    '## Visual differences',
    '',
    `${failures.length} snapshot test(s) differ from their baseline.`,
    '',
    `Download the **${cell(artifact)}** artifact and open \`${cell(report)}\` for expected, actual and diff images. Fix the regression or update and review the intended baselines.`,
    '',
    '| Test | Project |',
    '| --- | --- |',
    rows,
    '',
  ].join('\n');

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [resultsPath = 'test-results/results.json', artifact, report] = process.argv.slice(2);
  if (existsSync(resultsPath))
    process.stdout.write(playwrightSummary(JSON.parse(readFileSync(resultsPath, 'utf8')), { artifact, report }));
}
