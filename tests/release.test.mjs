import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createEvidence, verifyEvidence } from '../packages/tooling/release/evidence.mjs';

test('release evidence binds generator, base, head, tree, configuration and tooling', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const values = {
    source: 'a'.repeat(40),
    head: 'b'.repeat(40),
    tree: 'c'.repeat(40),
    repository: 'DuarteCaldeira/example',
    workflow: '.github/workflows/release.yml',
    runId: '12',
    configHash: 'config',
  };
  const report = {
    complete: true,
    profile: 'ci',
    groups: ['all'],
    results: [{ status: 'passed' }],
    commit: values.head,
    tree: values.tree,
    version: '0.1.0',
    finishedAt: '2026-11-14',
  };
  const envelope = createEvidence({ ...values, report }, privateKey);
  const expected = {
    ...values,
    toolingVersion: report.version,
    generator: 'github-actions[bot]',
    generatorId: 41898282,
  };
  assert.equal(verifyEvidence(envelope, publicKey, expected), true);
  for (const key of [
    'source',
    'head',
    'tree',
    'configHash',
    'toolingVersion',
    'generator',
    'generatorId',
  ])
    assert.equal(verifyEvidence(envelope, publicKey, { ...expected, [key]: 'stale' }), false);
  assert.equal(verifyEvidence({ ...envelope, signature: 'invalid' }, publicKey, expected), false);
  assert.throws(() =>
    createEvidence({ ...values, report: { ...report, complete: false } }, privateKey),
  );
  assert.throws(() =>
    createEvidence({ ...values, report: { ...report, groups: ['app'] } }, privateKey),
  );
});
