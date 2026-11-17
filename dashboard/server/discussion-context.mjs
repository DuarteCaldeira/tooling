import { discussionManifest } from '../release-items.mjs';
import { createDiscussionService } from './discussions.mjs';

export function createDiscussionProvider({ readSnapshot, openStore }) {
  return async (input) => {
    const [snapshot, store] = await Promise.all([
      readSnapshot({ preferCached: true }),
      openStore(),
    ]);
    let manifest = discussionManifest(snapshot);
    const versions = Object.hasOwn(manifest, input.repository ?? '')
      ? manifest[input.repository]
      : undefined;
    if (versions && input.version && !versions[input.version]?.includes(input.item ?? 'release'))
      manifest = discussionManifest(await readSnapshot());
    return createDiscussionService({ store, manifest });
  };
}
