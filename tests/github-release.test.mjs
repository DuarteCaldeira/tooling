import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createEvidence, digest } from '../packages/tooling/release/evidence.mjs';
import { verifyPullRequest } from '../packages/tooling/release/github.mjs';

test('API release routing rejects stale bases, modified heads, wrong authors and failed provenance', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const candidate = {
    repository: 'DuarteCaldeira/example',
    workflow: '.github/workflows/release.yml',
    runId: '12',
    source: 'a'.repeat(40),
    head: 'b'.repeat(40),
    tree: 'c'.repeat(40),
    configHash: digest('{}'),
  };
  const report = {
    complete: true,
    profile: 'ci',
    groups: ['all'],
    results: [{ status: 'passed' }],
    commit: candidate.head,
    tree: candidate.tree,
    version: '0.1.0',
  };
  const envelope = createEvidence({ ...candidate, report }, privateKey);
  const pr = {
    state: 'open',
    head: { sha: candidate.head, repo: { full_name: candidate.repository } },
    base: { ref: 'main' },
    user: { login: 'github-actions[bot]', id: 41898282 },
    body: `<!-- tooling-evidence:${Buffer.from(JSON.stringify(envelope)).toString('base64')} -->`,
  };
  const base = { object: { sha: candidate.source } };
  const run = {
    conclusion: null,
    path: candidate.workflow,
    event: 'workflow_dispatch',
    head_sha: candidate.source,
    repository: { full_name: candidate.repository },
  };
  const data = (value) => async () => ({ data: value });
  const github = {
    rest: {
      pulls: { get: data(pr) },
      git: { getCommit: data({ tree: { sha: candidate.tree } }), getRef: data(base) },
      repos: { getContent: data({ content: Buffer.from('{}').toString('base64') }) },
      actions: { getWorkflowRun: data(run) },
    },
  };
  const verify = () =>
    verifyPullRequest({
      github,
      owner: 'DuarteCaldeira',
      repo: 'example',
      number: 1,
      publicKey,
      workflow: candidate.workflow,
      version: report.version,
    });
  assert.equal(await verify(), true);
  base.object.sha = 'd'.repeat(40);
  assert.equal(await verify(), false);
  base.object.sha = candidate.source;
  pr.head.sha = 'd'.repeat(40);
  assert.equal(await verify(), false);
  pr.head.sha = candidate.head;
  pr.user.id = 1;
  assert.equal(await verify(), false);
  pr.user.id = 41898282;
  run.conclusion = 'failure';
  assert.equal(await verify(), false);
  run.conclusion = 'success';
  assert.equal(await verify(), true);
});
