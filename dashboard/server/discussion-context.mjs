import { discussionManifest } from '../release-items.mjs';
import { createDiscussionService } from './discussions.mjs';

export function createDiscussionProvider({ readSnapshot, openStore }) {
  let storePromise;
  const storage = () => {
    storePromise ??= Promise.resolve()
      .then(openStore)
      .catch((error) => {
        storePromise = undefined;
        throw error;
      });
    return storePromise;
  };
  return async (input) => {
    const [snapshot, store] = await Promise.all([readSnapshot({ preferCached: true }), storage()]);
    let manifest = discussionManifest(snapshot);
    const versions = Object.hasOwn(manifest, input.repository ?? '')
      ? manifest[input.repository]
      : undefined;
    const reported = /^reported-[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(input.item ?? '');
    if (
      versions &&
      input.version &&
      (!Object.hasOwn(versions, input.version) ||
        (!reported && !versions[input.version].includes(input.item ?? 'release')))
    )
      manifest = discussionManifest(await readSnapshot());
    return createDiscussionService({ store, manifest });
  };
}
