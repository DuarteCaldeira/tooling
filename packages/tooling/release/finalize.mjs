#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { verifyPullRequest } from './github.mjs';
import { gh, github } from './gh.mjs';

const [number] = process.argv.slice(2);
if (!/^\d+$/.test(number ?? '')) throw new Error('Usage: finalize.mjs <release-pr-number>');
const { nameWithOwner } = JSON.parse(gh('repo', 'view', '--json', 'nameWithOwner'));
const [owner, repo] = nameWithOwner.split('/');
const publicKey =
  process.env.REPO_TOOLING_RELEASE_PUBLIC_KEY ||
  gh(
    'api',
    `repos/${owner}/${repo}/actions/variables/REPO_TOOLING_RELEASE_PUBLIC_KEY`,
    '--jq',
    '.value',
  );
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (
  !(await verifyPullRequest({
    github,
    owner,
    repo,
    number,
    publicKey,
    workflow: '.github/workflows/release.yml',
    version,
  }))
)
  throw new Error('Release evidence is missing, stale or untrusted; regenerate the release');
const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number });
const { data: prepared } = await github.rest.git.getCommit({
  owner,
  repo,
  commit_sha: pr.head.sha,
});
gh('pr', 'merge', number, '--squash', '--match-head-commit', pr.head.sha);
const merged = JSON.parse(gh('api', `repos/${owner}/${repo}/pulls/${number}`));
if (!merged.merged) throw new Error('PR was not merged; no tag or release created');
const { data: commit } = await github.rest.git.getCommit({
  owner,
  repo,
  commit_sha: merged.merge_commit_sha,
});
if (commit.tree.sha !== prepared.tree.sha)
  throw new Error('Merged tree differs from the validated tree; publishing refused');
const manifest = JSON.parse(
  gh('api', `repos/${owner}/${repo}/contents/package.json?ref=${merged.merge_commit_sha}`),
);
const releaseVersion = JSON.parse(Buffer.from(manifest.content, 'base64')).version;
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(releaseVersion))
  throw new Error('Invalid release version');
const tag = `v${releaseVersion}`;
gh(
  'api',
  '--method',
  'POST',
  `repos/${owner}/${repo}/git/refs`,
  '-f',
  `ref=refs/tags/${tag}`,
  '-f',
  `sha=${merged.merge_commit_sha}`,
);
gh('release', 'create', tag, '--verify-tag', '--generate-notes', '--title', tag);
console.log(`Published ${tag} from validated tree ${commit.tree.sha}`);
