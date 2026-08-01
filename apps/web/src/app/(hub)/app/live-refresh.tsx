'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps an admin page current without anybody pressing anything.
 *
 * ★ USED BY THE CONSOLE AND THE TRAINING PAGE ★
 *
 * It started life beside the training page and was asked for again on the console — "the ticking
 * whos showed up". Moved up a directory rather than copied: two timers with two intervals drifting
 * apart is exactly the kind of difference nobody notices until one page feels stale and nobody can
 * say why.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "this needs to be ticking in real time please!"
 *
 * ★ A POLL, NOT A STREAM ★
 *
 * The live AI log is SSE because it carries events that happen at unpredictable moments and matter
 * within seconds. This is not that: the facts underneath change when a cron job starts or finishes,
 * which is a handful of times a day.
 *
 * An SSE endpoint would mean an open connection per officer with the page open, kept alive by a
 * heartbeat, to deliver a few events a day. A refresh every half minute costs one cheap query and
 * cannot leak a connection.
 *
 * ★ router.refresh(), NOT location.reload() ★
 *
 * The page is server-rendered. `refresh()` re-runs the server component and reconciles, so the
 * reader keeps their scroll position and nothing flashes. A full reload every thirty seconds would
 * make the page unusable while somebody was reading it — the opposite of the point.
 */

/** Half a minute. Fast enough that a start or a finish appears while somebody is looking. */
const DEFAULT_INTERVAL_MS = 30_000;

export function LiveRefresh({
  intervalMs = DEFAULT_INTERVAL_MS,
  label = 'Updating every 30 seconds',
}: {
  readonly intervalMs?: number;
  readonly label?: string;
} = {}) {
  const router = useRouter();
  const [at, setAt] = useState<Date | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = (): void => {
      router.refresh();
      setAt(new Date());
    };

    const start = (): void => {
      if (timer === null) timer = setInterval(tick, intervalMs);
    };
    const stop = (): void => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };

    /*
     * Paused while the tab is hidden. An officer who leaves this open on a second monitor overnight
     * should not spend the night querying — and the moment they look at it, the visibility change
     * fires and they get a fresh answer immediately rather than up to thirty seconds of a stale one.
     */
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        tick();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router, intervalMs]);

  return (
    /*
     * Said out loud, because a page that silently changes under somebody is unsettling — and
     * because "is this live, or am I looking at a snapshot" is exactly the question this page
     * exists to remove. Until the first tick it says so rather than showing a made-up time.
     */
    <p className="mt-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
      {label}
      {at === null
        ? ' · waiting for the first refresh'
        : ` · last checked ${at.toLocaleTimeString('en-GB')}`}
    </p>
  );
}
