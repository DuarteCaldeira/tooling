import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { inside } from './config.mjs';

const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const readFresh = (path, since) => {
  try {
    const stat = statSync(path);
    if (stat.size > 20 * 1024 * 1024 || stat.mtimeMs < since - 1000) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
};

export function collectMetrics(root, output, report, settings = {}) {
  const since = Date.parse(report.startedAt) || Date.now();
  const metrics = { slowTests: [] };
  const threshold = settings.slowTestMilliseconds ?? 500;
  const seen = new Set();
  const read = (path) => {
    const full = resolve(path);
    if (seen.has(full)) return null;
    seen.add(full);
    return readFresh(full, since);
  };
  const totals = {};
  function coverage(data) {
    if (!data?.total) return;
    for (const key of ['lines', 'branches', 'functions', 'statements']) {
      const value = data.total[key];
      if (!value) continue;
      if (finite(value.total) && finite(value.covered)) {
        const sum = totals[key] ?? { total: 0, covered: 0 };
        sum.total += value.total;
        sum.covered += value.covered;
        totals[key] = sum;
        metrics.coverage ??= {};
        metrics.coverage[key] = sum.total ? (100 * sum.covered) / sum.total : 100;
      } else if (finite(value.pct) && !totals[key]) {
        metrics.coverage ??= {};
        metrics.coverage[key] = value.pct;
      }
    }
  }
  function unit(data) {
    for (const file of data.testResults ?? [])
      for (const result of file.assertionResults ?? []) {
        if (finite(result.duration) && result.duration >= threshold)
          metrics.slowTests.push({
            name: [
              ...(result.ancestorTitles ?? []),
              result.title ?? result.fullName ?? file.name,
            ].join(' > '),
            milliseconds: result.duration,
          });
      }
  }
  function playwright(data) {
    const stats = data.stats ?? {};
    metrics.browser ??= { passed: 0, failed: 0, flaky: 0, skipped: 0 };
    for (const [key, field] of Object.entries({
      passed: 'expected',
      failed: 'unexpected',
      flaky: 'flaky',
      skipped: 'skipped',
    }))
      if (finite(stats[field])) metrics.browser[key] += stats[field];
    function visit(suite, parents = []) {
      for (const spec of suite.specs ?? [])
        for (const test of spec.tests ?? []) {
          const duration = Math.max(
            0,
            ...(test.results ?? []).map((result) => result.duration ?? 0),
          );
          if (finite(duration) && duration >= threshold)
            metrics.slowTests.push({
              name: [...parents, spec.title].join(' > '),
              milliseconds: duration,
            });
        }
      for (const child of suite.suites ?? []) visit(child, [...parents, child.title]);
    }
    for (const suite of data.suites ?? []) visit(suite, [suite.title]);
  }
  for (const check of report.results) {
    if (check.cached || ['excluded', 'unavailable'].includes(check.status)) continue;
    const kind = check.kind ?? check.id;
    const details = read(join(output, `${check.id}.details.json`));
    if (details?.bundle) metrics.bundle = details.bundle;
    if (details?.a11y)
      metrics.a11y = {
        pages: details.a11y.pages?.length ?? 0,
        violations: details.a11y.failures ?? 0,
        errors: details.a11y.errors?.length ?? 0,
      };
    if (details?.architecture)
      metrics.architecture = {
        files: details.architecture.files,
        issues: details.architecture.issues?.length ?? 0,
      };
    if (details?.dependencies)
      metrics.dependencies = {
        packages: details.dependencies.packages,
        issues: details.dependencies.issues?.length ?? 0,
        duplicates: details.dependencies.warnings?.length ?? 0,
      };
    if (kind === 'unit') {
      const data = read(join(output, `${check.id}-results/vitest.json`));
      if (data) unit(data);
      coverage(read(join(output, `${check.id}-results/coverage/coverage-summary.json`)));
    }
    if (['e2e', 'visual'].includes(kind)) {
      const data = read(join(output, `${check.id}-results/results.json`));
      if (data) playwright(data);
    }
  }
  for (const path of settings.coverage ?? []) {
    if (
      !report.results.some(
        (check) =>
          (check.kind ?? check.id) === 'unit' &&
          !check.cached &&
          !['excluded', 'unavailable'].includes(check.status),
      )
    )
      break;
    const data = read(inside(root, path));
    coverage(data);
  }
  for (const path of settings.unit ?? []) {
    if (
      report.results.some(
        (check) =>
          (check.kind ?? check.id) === 'unit' &&
          !check.cached &&
          !['excluded', 'unavailable'].includes(check.status),
      )
    ) {
      const data = read(inside(root, path));
      if (data) unit(data);
    }
  }
  for (const path of settings.playwright ?? []) {
    if (
      report.results.some(
        (check) =>
          ['e2e', 'visual'].includes(check.kind ?? check.id) &&
          !['excluded', 'unavailable'].includes(check.status),
      )
    ) {
      const data = read(inside(root, path));
      if (data) playwright(data);
    }
  }
  metrics.slowTests.sort((a, b) => b.milliseconds - a.milliseconds);
  metrics.slowTests = metrics.slowTests.slice(0, 20);
  return metrics;
}

export function readHistory(root) {
  try {
    const path = join(root, '.tooling/history/runs.json');
    if (statSync(path).size > 10 * 1024 * 1024) return [];
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (data.schemaVersion !== 1 || !Array.isArray(data.runs)) return [];
    return data.runs
      .filter(
        (run) =>
          typeof run.context === 'string' &&
          typeof run.finishedAt === 'string' &&
          typeof run.profile === 'string' &&
          typeof run.commit === 'string' &&
          typeof run.complete === 'boolean' &&
          finite(run.wallMilliseconds) &&
          Array.isArray(run.checks) &&
          run.checks.every((check) => typeof check.id === 'string' && finite(check.milliseconds)),
      )
      .slice(-1000);
  } catch {
    return [];
  }
}

export function performanceHistory(root, report, settings = {}) {
  const runs = readHistory(root);
  const context = createHash('sha256')
    .update(
      JSON.stringify({
        profile: report.profile,
        groups: [...report.groups].sort(),
        checks: [...report.required].sort(),
        node: report.node,
        platform: report.platform,
        configuration: report.configuration,
      }),
    )
    .digest('hex');
  const checks = report.results.map((result) => ({
    id: result.id,
    status: result.status,
    cached: Boolean(result.cached),
    milliseconds: finite(result.milliseconds) ? result.milliseconds : 0,
  }));
  const prior = runs.filter((run) => run.context === context && run.complete).slice(-10);
  const comparable = prior.filter(
    (run) =>
      run.checks.map((check) => `${check.id}:${check.cached}:${check.status}`).join() ===
      checks.map((check) => `${check.id}:${check.cached}:${check.status}`).join(),
  );
  const previousMs = median(comparable.map((run) => run.wallMilliseconds));
  const regressions = checks
    .filter((check) => check.status === 'passed' && !check.cached)
    .flatMap((check) => {
      const samples = prior.flatMap((run) =>
        run.checks
          .filter(
            (previous) =>
              previous.id === check.id && previous.status === 'passed' && !previous.cached,
          )
          .map((previous) => previous.milliseconds),
      );
      const baseline = median(samples);
      return samples.length >= 3 &&
        baseline > 0 &&
        check.milliseconds > baseline * (1 + (settings.regressionPercent ?? 25) / 100)
        ? [{ id: check.id, previousMs: baseline, currentMs: check.milliseconds }]
        : [];
    });
  const result = {
    runs: Math.min(runs.length + 1, settings.limit ?? 200),
    cacheHits: checks.filter((check) => check.cached).length,
    previousMs,
    deltaMs: previousMs === null ? null : report.wallMilliseconds - previousMs,
    regressions,
    bundleDeltaKB:
      finite(report.metrics?.bundle?.initialKB) && finite(prior.at(-1)?.bundleKB)
        ? report.metrics.bundle.initialKB - prior.at(-1).bundleKB
        : null,
  };
  if (settings.enabled === false) return { ...result, runs: 0 };
  const record = {
    context,
    finishedAt: report.finishedAt,
    commit: report.commit,
    profile: report.profile,
    complete: report.complete,
    wallMilliseconds: report.wallMilliseconds,
    checks,
    bundleKB: report.metrics?.bundle?.initialKB,
    coverage: report.metrics?.coverage,
    slowTests: report.metrics?.slowTests ?? [],
  };
  const directory = join(root, '.tooling/history');
  let lock;
  let lockPath;
  try {
    mkdirSync(directory, { recursive: true });
    lockPath = join(directory, 'write.lock');
    try {
      if (Date.now() - statSync(lockPath).mtimeMs > 120000) unlinkSync(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    lock = openSync(lockPath, 'wx');
    const target = join(directory, 'runs.json'),
      temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify({
        schemaVersion: 1,
        runs: [...readHistory(root), record].slice(-(settings.limit ?? 200)),
      }),
    );
    renameSync(temporary, target);
  } catch (error) {
    // History is telemetry: a full or read-only disk must not fail a validation that passed.
    if (error.code !== 'EEXIST') console.warn(`History not saved: ${error.message}`);
  } finally {
    if (lock !== undefined) {
      closeSync(lock);
      unlinkSync(lockPath);
    }
  }
  return result;
}

export function historyText(root, limit = 20) {
  const runs = readHistory(root).slice(-limit);
  return runs.length
    ? runs
        .map(
          (run) =>
            `${run.finishedAt}  ${run.profile.padEnd(4)}  ${run.complete ? 'passed' : 'failed'}  ${(run.wallMilliseconds / 1000).toFixed(2)}s  ${run.checks.filter((check) => check.cached).length}/${run.checks.length} cached  ${run.commit?.slice(0, 8) ?? ''}`,
        )
        .join('\n')
    : 'No validation history yet.';
}
