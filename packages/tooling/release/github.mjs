import { verifyEvidence, digest } from './evidence.mjs';

export async function verifyPullRequest({
  github,
  owner,
  repo,
  number,
  publicKey,
  workflow,
  version,
  configPath = 'repo-tooling.config.json',
}) {
  if (!publicKey) return false;
  try {
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: Number(number) });
    if (pr.state !== 'open' || pr.head.repo.full_name !== `${owner}/${repo}`) return false;
    const marker = pr.body?.match(/<!-- repo-tooling-evidence:([A-Za-z0-9+/=]+) -->/);
    if (!marker) return false;
    const envelope = JSON.parse(Buffer.from(marker[1], 'base64'));
    const { data: head } = await github.rest.git.getCommit({
      owner,
      repo,
      commit_sha: pr.head.sha,
    });
    const { data: base } = await github.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${pr.base.ref}`,
    });
    const { data: config } = await github.rest.repos.getContent({
      owner,
      repo,
      path: configPath,
      ref: pr.head.sha,
    });
    const expected = {
      repository: `${owner}/${repo}`,
      workflow,
      source: base.object.sha,
      head: pr.head.sha,
      tree: head.tree.sha,
      toolingVersion: version,
      configHash: digest(Buffer.from(config.content, 'base64')),
      generator: pr.user.login,
      generatorId: pr.user.id,
    };
    if (!verifyEvidence(envelope, publicKey, expected)) return false;
    const payload = JSON.parse(Buffer.from(envelope.payload, 'base64'));
    const { data: run } = await github.rest.actions.getWorkflowRun({
      owner,
      repo,
      run_id: Number(payload.runId),
    });
    return (
      (!run.conclusion || run.conclusion === 'success') &&
      run.path === workflow &&
      run.event === 'workflow_dispatch' &&
      run.head_sha === expected.source &&
      run.repository.full_name === expected.repository
    );
  } catch {
    return false;
  }
}
