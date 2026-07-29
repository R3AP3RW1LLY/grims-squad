'use client';

import { useEffect, useState } from 'react';

/**
 * How long a commander has been flying this session, counting up.
 *
 * ★ WHERE THE START TIME COMES FROM ★
 *
 * `LoadGame` — the event the game writes when it finishes loading, which is
 * exactly "this session began". It rides in the `session` category, the one
 * category a member cannot switch off, so it is present for everybody who is
 * playing. No new field and no session table: the roster snapshot already reads
 * the newest LoadGame per member as `lastPlayedAt`.
 *
 * Deliberately NOT the presence heartbeat. That is refreshed every twenty
 * seconds, so counting from it would show every commander as twenty seconds
 * into their session, forever.
 *
 * ★ ONE INTERVAL FOR THE WHOLE PAGE ★
 *
 * A roster of a hundred commanders would otherwise hold a hundred timers all
 * firing a second apart, waking React a hundred times a second to move a
 * hundred separate digits. They share one tick and re-render together.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let ticker: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: Listener): () => void {
  listeners.add(fn);

  // Started on the FIRST subscriber and stopped after the last, so a page with
  // nobody playing runs no timer at all.
  ticker ??= setInterval(() => {
    for (const l of listeners) l();
  }, 1000);

  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

/**
 * `4m 12s`, `2h 07m`, `1d 3h`.
 *
 * The unit pair changes with the magnitude because seconds stop being
 * interesting an hour in, and minutes stop being interesting a day in — but
 * something must keep moving, or it reads as frozen.
 */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);

  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function SessionTimer({ startedAt }: { startedAt: string }) {
  /*
   * ★ NULL UNTIL MOUNTED, ON PURPOSE ★
   *
   * The server renders at one instant and the browser hydrates at another, so
   * rendering a duration on the server guarantees a hydration mismatch — React
   * would discard the markup and warn, on every card, every load.
   *
   * Null renders nothing, and the first tick fills it in a frame later.
   */
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    const began = new Date(startedAt).getTime();
    if (!Number.isFinite(began)) return;

    const update = (): void => setElapsed(Date.now() - began);
    update();
    return subscribe(update);
  }, [startedAt]);

  /*
   * A clock skewed ahead would otherwise count DOWN from a negative number,
   * which looks like a fault in the site rather than in a clock.
   */
  if (elapsed === null || elapsed < 0) return null;

  return (
    <span className="font-mono tabular-nums text-[var(--color-text-secondary)]">
      {formatElapsed(elapsed)}
    </span>
  );
}
