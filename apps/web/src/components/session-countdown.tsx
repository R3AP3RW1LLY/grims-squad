'use client';

import { useEffect, useState } from 'react';
import { formatLocal } from '../lib/time';

/**
 * How long until this sign-in ends.
 *
 * ★ IT SHOWS SECONDS BECAUSE IT TICKS ★
 *
 * The first version updated every second and rendered `13d 23h 59m`. It was
 * live and looked frozen — the smallest unit on screen changed once a minute,
 * so for fifty-nine seconds out of sixty it was indistinguishable from a static
 * figure somebody had baked into the page.
 *
 * A countdown that does not visibly count is worse than a plain date: it claims
 * to be live and gives no evidence.
 *
 * ★ COUNTS TO AN INSTANT, NOT FROM A DURATION ★
 *
 * The server sends the moment the session ends, not "14 days left". A duration
 * is wrong the second it renders — the page may sit open for hours — and it
 * would need our clock and the browser's to agree on elapsed TIME. An instant
 * only needs them to agree on what time it is, which they already do.
 *
 * ★ WHY IT IS ON THE PAGE AT ALL ★
 *
 * Being signed out is the most common thing that happens to somebody using the
 * hub, and it is normally a surprise: you come back, click something, and are
 * bounced to Discord for no visible reason. A number turns that into something
 * expected.
 */

function split(msLeft: number): { d: number; h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `13d 23h 59m 04s` — always down to the second, so the tick is visible. */
function countdownText(msLeft: number): string {
  const { d, h, m, s } = split(msLeft);
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  return `${m}m ${pad(s)}s`;
}

export function SessionCountdown({
  expiresAt,
  twoFactorExpiresAt,
  timezone,
}: {
  expiresAt: string | null;
  twoFactorExpiresAt: string | null;
  /** The member's own zone, so the end time is not read off the device. */
  timezone: string;
}) {
  /*
   * `null` until mounted, so the SERVER renders nothing rather than a figure
   * from its own clock. Emitting "13d 23h 59m 04s" server-side and a different
   * second in the browser is a hydration mismatch — React would replace the
   * block after mount, and every page load would flicker.
   */
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    // Every second, and read from the CLOCK each tick rather than counting
    // intervals. A tab that is backgrounded gets its timers throttled, so a
    // counter that decremented itself would drift and then jump on return.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (expiresAt === null || now === null) return null;

  const left = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(left)) return null;

  const expired = left <= 0;
  const urgent = left > 0 && left < 60 * 60_000;
  const soon = left > 0 && left < 24 * 60 * 60_000;

  const stepUp = twoFactorExpiresAt === null ? null : new Date(twoFactorExpiresAt).getTime() - now;

  return (
    <div
      className={`rounded-lg border p-5 ${
        expired || urgent
          ? 'border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_8%,transparent)]'
          : 'border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]'
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
        {expired ? 'Session ended' : 'You will be signed out in'}
      </p>

      <p
        className={`mt-2 text-2xl leading-none ${
          expired || urgent
            ? 'text-[var(--color-semantic-warning)]'
            : soon
              ? 'text-[var(--color-brand-orange-bright)]'
              : 'text-[var(--color-text-primary)]'
        }`}
        style={{
          fontFamily: 'var(--font-mono)',
          // Without this the row changes width as digits change shape, and the
          // whole card twitches once a second.
          fontVariantNumeric: 'tabular-nums',
        }}
        /*
         * `off`, not `polite`. A per-second counter announced politely makes a
         * screen reader read numbers continuously and drown out everything else
         * on the page. The sentence underneath carries the same information in
         * a form worth hearing once.
         */
        aria-live="off"
      >
        {expired ? '00m 00s' : countdownText(left)}
      </p>

      {/*
        ★ IT WAS DESCRIBING AN ENDING — SQUADRON OWNER, 2026-08-05 ★

        "this sounds to the user that they are just going to loose access and not be allowed back!"

        And it did. "Signing in lasts 14 days and is not extended by using the site" is every true
        fact about the mechanism and not one word about what happens next, so the only thing left
        to infer is that something is taken away. Read on a page that also counts down in red, it
        lands as a warning about losing the account rather than a note about a browser session.

        Nothing is lost and nothing is revoked: the sign-in is a fourteen-day cookie, and renewing
        it is the Discord button, once. That is the sentence that was missing, so it now leads.

        The fourteen days and the fixed deadline are still stated — they are true, they explain the
        number above it, and a member who wants to know why it does not reset deserves the answer.
        They are simply no longer the whole message. The security property is unchanged: an
        absolute lifetime that using the site does not extend is deliberate, and this is a
        rewording, not a loosening.
      */}
      <p className="mt-2.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">
        {expired ? (
          'This sign-in has run its fourteen days. Your next click sends you to Discord to sign back in — one button, and you carry on where you left off.'
        ) : (
          <>
            You stay signed in for 14 days from signing in, and the clock does not reset as you use
            the site &mdash; so this one ends{' '}
            <span className="text-[var(--color-text-primary)]">
              {formatLocal(expiresAt, timezone)}
            </span>
            . Nothing happens to your account when it does: you sign in with Discord again, which
            takes a click, and everything is exactly where you left it.
          </>
        )}
      </p>

      {/*
        Only for somebody who HAS a step-up. An ordinary member has no second
        factor to expire, and a line about one would be a puzzle rather than
        information.
      */}
      {stepUp !== null && (
        <p className="mt-3 border-t border-[var(--color-border-hairline)] pt-3 text-xs text-[var(--color-text-secondary)]">
          {stepUp <= 0 ? (
            <>
              Admin access{' '}
              <span className="text-[var(--color-semantic-warning)]">needs a new code</span>
            </>
          ) : (
            <>
              Admin access for another{' '}
              <span
                className="font-mono text-[var(--color-brand-cyan-bright)]"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {countdownText(stepUp)}
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
