import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { builtins, classify, matches, workspaceFiles } from './graph.mjs';

const diagnostics = new Set(['format', 'lint', 'styles', 'translations', 'deadcode', 'workflows']);
const fresh = new Set([
  'security',
  'build',
  'size',
  'unit',
  'e2e',
  'visual',
  'lighthouse',
  'database',
  'a11y',
  'dependency-consistency',
]);

export function checkCache(root, config, selection, state, { disabled = false } = {}) {
  const pending = new Map();
  const directory = join(root, '.tooling/state/checks');
  function eligible(check) {
    const kind = check.kind ?? check.id;
    if (
      disabled ||
      config.execution?.checkCache === false ||
      fresh.has(kind) ||
      check.dependsOn?.length ||
      check.cache === false
    )
      return false;
    const overrides = config.checks?.[check.id];
    if (
      !check.cache &&
      (!diagnostics.has(kind) ||
        ['command', 'devCommand', 'devAllCommand'].some((name) => overrides?.[name] !== undefined))
    )
      return false;
    return Boolean(check.cache || builtins[kind]);
  }
  function key(check, command, files) {
    if (!eligible(check)) return null;
    const all = Object.keys(state.files);
    const scoped = new Set(workspaceFiles(config, check.workspaces, all));
    const patterns = typeof check.cache === 'object' ? check.cache.inputs : null;
    const input = all
      .filter((file) => {
        // Config, lockfiles and unknown paths always invalidate, even for narrowed input sets.
        const global = classify([file], config).some((group) =>
          ['tooling', 'dependencies', 'unknown'].includes(group),
        );
        return (
          global ||
          (patterns ? patterns.some((pattern) => matches(file, pattern)) : scoped.has(file))
        );
      })
      .sort()
      .map((file) => [file, state.files[file]]);
    const tools = new Set([
      ...(check.tools ?? []),
      ...(Array.isArray(command) ? [command[0]] : []),
    ]);
    const identities = state.tools.filter(
      (tool) => tools.has(tool.name) && tool.cwd === resolve(root, check.cwd ?? '.'),
    );
    const { files: _selection, ...definition } = check;
    return createHash('sha256')
      .update(
        JSON.stringify({
          schemaVersion: 1,
          context: state.context,
          check: definition,
          command,
          profile: selection.profile,
          files,
          input,
          tools: identities,
        }),
      )
      .digest('hex');
  }
  return {
    reusablePass: selection.checks.every(eligible),
    get(check, command, files) {
      const fingerprint = key(check, command, files);
      if (!fingerprint) return null;
      pending.set(check.id, fingerprint);
      try {
        const record = JSON.parse(readFileSync(join(directory, `${fingerprint}.json`), 'utf8'));
        if (
          record.schemaVersion === 1 &&
          record.fingerprint === fingerprint &&
          record.id === check.id &&
          record.status === 'passed'
        )
          return {
            status: 'passed',
            cached: true,
            milliseconds: 0,
            reason: 'Matching deterministic check inputs',
          };
      } catch {}
      return null;
    },
    commit(results) {
      for (const result of results) {
        const fingerprint = pending.get(result.id);
        if (!fingerprint || result.status !== 'passed' || result.cached) continue;
        mkdirSync(directory, { recursive: true });
        const target = join(directory, `${fingerprint}.json`);
        const temporary = `${target}.${randomUUID()}.tmp`;
        writeFileSync(
          temporary,
          JSON.stringify({ schemaVersion: 1, id: result.id, fingerprint, status: 'passed' }),
        );
        renameSync(temporary, target);
      }
    },
  };
}
