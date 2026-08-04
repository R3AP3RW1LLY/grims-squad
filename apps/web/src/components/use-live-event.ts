'use client';

import { useEffect, useRef } from 'react';

/**
 * Calls `onEvent` whenever the server's live stream emits `type`.
 *
 * ★ THE SAME EventSource IDIOM AS live-refresh.tsx, WITHOUT THE ROUTER ★
 *
 * LiveRefresh exists to re-run SERVER components. The notification badge is CLIENT state, and
 * coupling it to router.refresh() would re-render the entire page to change the number on a pill —
 * so this hook only reports that the event happened, and the caller decides what one event costs.
 *
 * EventSource rather than fetch-with-a-reader for the reason live-refresh gives: it reconnects on
 * its own with backoff, which is most of what a hand-rolled version would have to get right.
 * Errors are deliberately not handled beyond letting it retry — closing the source on error turns
 * a five-second network blip into a permanently dead stream that only a page reload fixes.
 */
export function useLiveEvent(type: string, onEvent: () => void): void {
  /*
   * The callback lives in a ref so the stream is not torn down and re-opened on every render —
   * callers pass an inline closure, and its identity changes each time.
   */
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const source = new EventSource('/v1/live', { withCredentials: true });

    /*
     * Coalesced, same as LiveRefresh: a burst of events landing in a few milliseconds should cost
     * one refetch, not one per event.
     */
    let pending: ReturnType<typeof setTimeout> | null = null;
    const listener = (): void => {
      if (pending !== null) return;
      pending = setTimeout(() => {
        pending = null;
        handler.current();
      }, 400);
    };

    source.addEventListener(type, listener);

    return () => {
      if (pending !== null) clearTimeout(pending);
      source.removeEventListener(type, listener);
      source.close();
    };
  }, [type]);
}
