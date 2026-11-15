import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { blobStore, createDiscussionService, createHandler } from '../server/discussions.mjs';

const handler = createHandler(async () => {
  const manifest = JSON.parse(
    await readFile(join(process.cwd(), 'server/discussion-manifest.json'), 'utf8'),
  );
  return createDiscussionService({ store: await blobStore(), manifest });
});

export const GET = handler;
export const POST = handler;
