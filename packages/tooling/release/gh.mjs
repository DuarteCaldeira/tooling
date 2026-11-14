import { execFileSync } from 'node:child_process';

export const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const get = (path) => Promise.resolve({ data: JSON.parse(gh('api', path)) });
export const github = {
  rest: {
    pulls: {
      get: ({ owner, repo, pull_number }) => get(`repos/${owner}/${repo}/pulls/${pull_number}`),
    },
    git: {
      getCommit: ({ owner, repo, commit_sha }) =>
        get(`repos/${owner}/${repo}/git/commits/${commit_sha}`),
      getRef: ({ owner, repo, ref }) => get(`repos/${owner}/${repo}/git/ref/${ref}`),
    },
    repos: {
      getContent: ({ owner, repo, path, ref }) =>
        get(`repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`),
    },
    actions: {
      getWorkflowRun: ({ owner, repo, run_id }) =>
        get(`repos/${owner}/${repo}/actions/runs/${run_id}`),
    },
  },
};
