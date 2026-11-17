import { releaseSnapshot } from '../server/releases.mjs';
import { createDiscussionProvider } from '../server/discussion-context.mjs';
import { blobStore, createHandler } from '../server/discussions.mjs';

const handler = createHandler(
  createDiscussionProvider({ readSnapshot: releaseSnapshot, openStore: blobStore }),
);

export const GET = handler;
export const POST = handler;

