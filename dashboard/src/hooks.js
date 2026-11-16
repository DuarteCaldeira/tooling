import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { lockPageScroll } from './lib/scroll-lock.js';

const EMPTY = Object.freeze({});

/** Shared validation state and comment counts, loaded per repository. */
export function useReview() {
  const [summaries, setSummaries] = useState({});
  const [states, setStates] = useState({});
  const [errors, setErrors] = useState({});

  const refresh = useCallback(async (repository) => {
    try {
      const result = await api({ repository, view: 'summary' });
      setSummaries((current) => ({ ...current, [repository]: result.summary ?? EMPTY }));
      setStates((current) => ({ ...current, [repository]: result.states ?? EMPTY }));
      setErrors((current) => ({ ...current, [repository]: false }));
      return true;
    } catch {
      setErrors((current) => ({ ...current, [repository]: true }));
      return false;
    }
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
      if (!(await refresh(context.repository)))
        throw new Error('Estado guardado. Atualize a revisão para o confirmar.');
    },
    [refresh],
  );

  return {
    refresh,
    stateOf,
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

/** A string kept in sync with the URL query, e.g. `?topic-filter=ux`. */
export function useQueryState(key, fallback) {
  const [value, setValue] = useState(() => new URLSearchParams(location.search).get(key) ?? fallback);
  return [value, setValue];
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
