import { useEffect } from 'preact/hooks';

/**
 * Keeps a page's data current without anybody pressing anything.
 *
 * ★ SQUADRON OWNER, 2026-08-04: "with all data updated in realtime please!" ★
 *
 * Polling, deliberately, at a stated cadence — not a socket. Every read these pages make is a
 * cached or indexed query the hub serves in milliseconds, and the data itself moves on the pace
 * of the EDDN relay and the half-hourly board rebuilds. A socket would add a connection to keep
 * alive, a reconnect dance, and a second data path to disagree with the fetchers — to deliver
 * numbers faster than they actually change.
 *
 * The interval also refires when the window regains focus: the moment somebody alt-tabs back from
 * the game is exactly when they want the screen to be current, and exactly when it is least
 * likely to be.
 */
export function useLive(load: () => void, everyMs = 60_000): void {
  useEffect(() => {
    const timer = setInterval(load, everyMs);
    const onFocus = (): void => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
    // Deliberately keyed on the cadence alone: `load` is a fresh closure every render, and
    // re-subscribing per render would reset the clock constantly. The pages pass loaders that
    // read whatever state they need at call time.
  }, [everyMs]);
}
