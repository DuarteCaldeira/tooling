import { releaseSnapshot } from '../server/releases.mjs';
import { discussionManifest } from '../release-items.mjs';
import { blobStore, createDiscussionService, createHandler } from '../server/discussions.mjs';

const handler = createHandler(async () => {
  const manifest = discussionManifest(await releaseSnapshot());
  return createDiscussionService({ store: await blobStore(), manifest });
});

export const GET = handler;
export const POST = handler;
