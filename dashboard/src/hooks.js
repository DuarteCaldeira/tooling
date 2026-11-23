import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { lockPageScroll } from './lib/scroll-lock.js';

const EMPTY = Object.freeze({});

export function useReview() {
  const [summaries, setSummaries] = useState({});
  const [states, setStates] = useState({});
  const [errors, setErrors] = useState({});
  const [reportedItems, setReportedItems] = useState({});

  const requests = useRef(new Map());
  const fetchedAt = useRef(new Map());
  const refresh = useCallback((repository, { force = false, maxAge = 0 } = {}) => {
    const active = requests.current.get(repository);
    if (active && !force) return active;
    if (!force && Date.now() - (fetchedAt.current.get(repository) ?? 0) < maxAge)
      return Promise.resolve(true);
    const request = api({ repository, view: 'summary' })
      .then((result) => {
        if (requests.current.get(repository) !== request) return true;
        setSummaries((current) => ({ ...current, [repository]: result.summary ?? EMPTY }));
        setStates((current) => ({ ...current, [repository]: result.states ?? EMPTY }));
        setReportedItems((current) => ({
          ...current,
          [repository]: result.reportedItems ?? EMPTY,
        }));
        setErrors((current) => ({ ...current, [repository]: false }));
        fetchedAt.current.set(repository, Date.now());
        return true;
      })
      .catch(() => {
        if (requests.current.get(repository) === request)
          setErrors((current) => ({ ...current, [repository]: true }));
        return false;
      })
      .finally(() => {
        if (requests.current.get(repository) === request) requests.current.delete(repository);
      });
    requests.current.set(repository, request);
    return request;
  }, []);

  const stateOf = useCallback(
    (context) => {
      const review = states[context.repository]?.[context.version]?.[context.item];
      return {
        count: summaries[context.repository]?.[context.version]?.[context.item] ?? 0,
        validated: review?.validated ?? false,
        closed: review?.closed ?? false,
      };
    },
    [summaries, states],
  );

  const setField = useCallback(
    async (context, field, value) => {
      await api(
        {},
        {
          repository: context.repository,
          version: context.version,
          item: context.item,
          action: 'state',
          field,
          value,
          requestId: crypto.randomUUID(),
        },
      );
      setStates((current) => ({
        ...current,
        [context.repository]: {
          ...current[context.repository],
          [context.version]: {
            ...current[context.repository]?.[context.version],
            [context.item]: {
              ...current[context.repository]?.[context.version]?.[context.item],
              [field]: value,
            },
          },
        },
      }));
      refresh(context.repository, { force: true });
    },
    [refresh],
  );

  return {
    refresh,
    stateOf,
    reportedItemsOf: (repository, version) => reportedItems[repository]?.[version] ?? [],
    setField,
    isLoaded: (repository) => repository in summaries,
    hasError: (repository) => Boolean(errors[repository]),
  };
}

/** Re-run `callback` every `ms` while the tab is visible. */
export function usePolling(callback, ms, enabled) {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => {
      if (!document.hidden) saved.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}

/** The scroll lock lasts exactly as long as the conversation panel is mounted. */
export function useConversationOverlay(open, contentRef) {
  useLayoutEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const unlock = lockPageScroll();
    // Drawer portals mount after their initial render; wait for the dialog to exist.
    const frame = requestAnimationFrame(() => {
      const dialog = contentRef.current?.closest('[role="dialog"]');
      (dialog?.querySelector('button') ?? dialog)?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      unlock();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, contentRef]);
}
