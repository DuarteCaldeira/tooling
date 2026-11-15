import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function requestDeployment(hook, fetchImpl = fetch) {
  if (!hook) throw new Error('Set the VERCEL_DEPLOY_HOOK Actions secret');
  let url;
  try {
    url = new URL(hook);
  } catch {
    throw new Error('Invalid Vercel deploy hook');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'api.vercel.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/v1\/integrations\/deploy\/[^/]+\/[^/]+\/?$/.test(url.pathname)
  )
    throw new Error('Expected an HTTPS Vercel deploy hook');
  url.searchParams.set('buildCache', 'false');
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('Vercel deployment request failed');
  }
  if (!response.ok) throw new Error(`Vercel rejected deployment request (${response.status})`);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Invalid Vercel deployment response');
  }
  if (typeof result.job?.id !== 'string' || !result.job.id)
    throw new Error('Vercel did not acknowledge a deployment job');
  return { requested: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await requestDeployment(process.env.VERCEL_DEPLOY_HOOK);
  const message =
    'Vercel deployment requested. Check the Vercel project for build status and the live URL.';
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}
