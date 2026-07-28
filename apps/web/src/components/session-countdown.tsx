'use client';

import { useEffect, useState } from 'react';

/**
 * How long is left on this sign-in.
 *
 * ★ COUNTS TO AN INSTANT, NOT FROM A DURATION ★
 *
 * The server sends the moment the session ends, not "14 days left". A duration
 * would be wrong the second it was rendered — the page may sit open for hours —
 * and it would also require our clock and the browser's to agree on elapsed
 * time. An instant only requires them to agree on what time it is, which they
 * already do.
 *
 * ★ WHY THIS IS SHOWN AT ALL ★
 *
 * Being signed out is the most common thing that happens to somebody using the
 * hub, and it is normally a surprise: you come back, click something, and are
 * bounced to Discord for no visible reason. A number on the dashboard turns
 * that into something expected.
 */

function parts(msLeft: number): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export function SessionCountdown({
  expiresAt,
  twoFactorExpiresAt,
}: {
  expiresAt: string | null;
  twoFactorExpiresAt: string | null;
}) {
  /*
   * `null` until mounted, so the SERVER renders nothing rather than a figure
   * computed from its own clock. Rendering "13d 23h 59m" on the server and a
   * second less in the browser is a hydration mismatch, and React would replace
   * the whole block after mount — a visible flicker on every page load.
   */
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    /*
     * Every second. It costs nothing, and a countdown that ticks in minutes
     * looks frozen — somebody watching it to see whether it is live cannot
     * tell, which defeats the purpose of showing it.
     */
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (expiresAt === null || now === null) return null;

  const left = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(left)) return null;

  const { days, hours, minutes, seconds } = parts(left);
  const expired = left <= 0;

  /*
   * Under a day is worth flagging. A member with three days left does not need
   * to think about it; one with twenty minutes is about to lose whatever they
   * are in the middle of.
   */
  const urgent = left > 0 && left < 24 * 3600_000;

  const stepUp = twoFactorExpiresAt === null ? null : new Date(twoFactorExpiresAt).getTime() - now;

  return (
    <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
        Signed in for
      </p>

      <p
        className={`mt-2 text-2xl leading-none ${
          expired
            ? 'text-[var(--color-semantic-hostile-bright)]'
            : urgent
              ? 'text-[var(--color-semantic-warning)]'
              : 'text-[var(--color-text-primary)]'
        }`}
        style={{ fontFamily: 'var(--font-display)' }}
        // Announced on a slow cadence, not every tick. `off` would hide a
        // change a member cares about; `polite` on a per-second counter would
        // make a screen reader read numbers continuously and drown everything
        // else out. The title carries the same information on demand.
        aria-live="off"
      >
        {expired
          ? 'Expired'
          : days > 0
            ? `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`
            : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`}
      </p>

      <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
        {expired
          ? 'Your next action will send you back to Discord to sign in again.'
          : `Signing in lasts 14 days. Ends ${new Date(expiresAt).toLocaleString('en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}.`}
      </p>

      {/*
        Only shown to somebody who HAS a step-up — an ordinary member has no
        second factor to expire, and a line about one would be a puzzle rather
        than information.
      */}
      {stepUp !== null && (
        <p className="mt-3 border-t border-[var(--color-border-hairline)] pt-3 text-xs text-[var(--color-text-secondary)]">
          Admin access{' '}
          {stepUp <= 0 ? (
            <span className="text-[var(--color-semantic-warning)]">needs a new code</span>
          ) : (
            <>
              for another{' '}
              <span className="font-mono text-[var(--color-brand-cyan-bright)]">
                {Math.floor(stepUp / 60_000)}m
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
