import { sign, verify, createHash } from 'node:crypto';

export const digest = (value) => createHash('sha256').update(value).digest('hex');
const sha = /^[a-f0-9]{40}$/;

export function createEvidence(
  { report, source, head, tree, repository, workflow, runId, configHash },
  privateKey,
) {
  if (
    !report.complete ||
    report.profile !== 'ci' ||
    !report.groups.includes('all') ||
    report.results.some((r) => r.status !== 'passed')
  )
    throw new Error('Full CI validation must pass before release preparation can be certified');
  if (
    report.commit !== head ||
    report.tree !== tree ||
    ![source, head, tree].every((s) => sha.test(s))
  )
    throw new Error('Validation does not match the prepared release');
  const payload = {
    schemaVersion: 1,
    repository,
    workflow,
    runId,
    source,
    head,
    tree,
    toolingVersion: report.version,
    configHash,
    validatedAt: report.finishedAt,
  };
  const data = Buffer.from(JSON.stringify(payload));
  return {
    payload: data.toString('base64'),
    signature: sign(null, data, privateKey).toString('base64'),
  };
}

export function verifyEvidence(envelope, publicKey, expected) {
  try {
    const data = Buffer.from(envelope.payload, 'base64');
    if (!verify(null, data, publicKey, Buffer.from(envelope.signature, 'base64'))) return false;
    const payload = JSON.parse(data);
    if (
      payload.schemaVersion !== 1 ||
      !['source', 'head', 'tree'].every((key) => sha.test(payload[key]))
    )
      return false;
    if (
      !['repository', 'workflow', 'source', 'head', 'tree', 'toolingVersion', 'configHash'].every(
        (key) => typeof expected[key] === 'string' && payload[key] === expected[key],
      )
    )
      return false;
    return expected.generator === 'github-actions[bot]' && expected.generatorId === 41898282;
  } catch {
    return false;
  }
}
