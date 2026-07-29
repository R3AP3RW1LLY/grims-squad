'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-renders the page when the server says its data changed.
 *
 * ★ router.refresh(), NOT A RELOAD ★
 *
 * `refresh()` re-runs the SERVER components and swaps the result in. Scroll
 * position, focus, open menus and any client state all survive — which is the
 * whole difference between a page that updates and a page that flickers and
 * loses where you were.
 *
 * A full reload would also drop the SSE connection and re-open it, so a busy
 * squadron would reconnect continuously.
 *
 * ★ THE PAGE DECIDES WHAT IT CARES ABOUT ★
 *
 * `types` is required rather than defaulting to everything. A dashboard that
 * refreshed on every squadron-wide presence ping would re-render constantly
 * while showing the same numbers, and "live" would cost more than it gave.
 */
export function LiveRefresh({ types }: { types: readonly string[] }) {
  const router = useRouter();

  /*
   * Held in a ref so the effect does not re-run when the array identity changes
   * on every render — which it does, because callers pass a literal. Without
   * this the stream is torn down and re-opened on each render.
   */
  const wanted = useRef(types);
  wanted.current = types;

  useEffect(() => {
    /*
     * EventSource, not fetch-with-a-reader. It reconnects on its own with
     * backoff, which is most of what a hand-rolled version would have to get
     * right — and getting it wrong means either a dead stream or a reconnect
     * storm, neither of which is visible in development.
     */
    const source = new EventSource('/v1/live', { withCredentials: true });

    /*
     * Coalesced. A batch upload can publish several events in a few
     * milliseconds, and refreshing per event would re-render the page three
     * times to show one change.
     */
    let pending: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      if (pending !== null) return;
      pending = setTimeout(() => {
        pending = null;
        router.refresh();
      }, 400);
    };

    const listeners = wanted.current.map((type) => {
      const handler = (): void => schedule();
      source.addEventListener(type, handler);
      return { type, handler };
    });

    /*
     * Errors are deliberately NOT handled beyond letting EventSource retry.
     * Closing the source on error would turn a five-second network blip into a
     * permanently dead stream that only a page reload fixes — and the member
     * would have no way to know their page had stopped updating.
     */

    return () => {
      if (pending !== null) clearTimeout(pending);
      for (const l of listeners) source.removeEventListener(l.type, l.handler);
      source.close();
    };
  }, [router]);

  // Renders nothing. It is a subscription, not a component with a face.
  return null;
}
