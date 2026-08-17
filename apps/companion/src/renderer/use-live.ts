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
/**
 * ★ FIFTEEN SECONDS, NOT SIXTY — SQUADRON OWNER, 2026-08-17 ★
 *
 * "we can also increase the live polling of the journal entries to try to make this as real-time as
 * possible, on both web and companion app".
 *
 * Every read behind this is a cached or indexed query the hub answers in milliseconds, and the
 * screens that use it are open on one machine at a time — so four times the cadence is still a
 * handful of requests a minute per member. What it buys is a carrier figure that follows a transfer
 * while somebody is still looking at it.
 *
 * Callers that watch something genuinely slow still pass their own interval; this is only the
 * default for screens whose numbers move on other people's hauling.
 */
export function useLive(load: () => void, everyMs = 15_000): void {
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
