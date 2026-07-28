'use client';

import { useState } from 'react';
import { apiPost } from '../../../../lib/api-client';

/**
 * Pick a timezone, and go in.
 *
 * ★ ONE CALL, NOT TWO ★
 *
 * Saving the zone and marking the step done happen in a single request. Two
 * would leave somebody who closed the tab in between with a timezone stored and
 * the step still owed — asked again on their next sign-in, with the answer
 * already filled in and nothing explaining why they are back here.
 */
export function CommanderOnboardingForm({
  initial,
  zones,
  isAdmin,
}: {
  initial: string;
  zones: string[];
  isAdmin: boolean;
}) {
  /*
   * Seeded from the BROWSER when the stored value is still the default.
   *
   * A guess is the wrong thing to store silently and the right thing to
   * suggest: it is correct for most people most of the time, and it is sitting
   * in front of somebody who can see it is wrong and change it. Storing it
   * without asking is what we are avoiding, not offering it.
   */
  const [timezone, setTimezone] = useState(() => {
    if (initial !== 'UTC') return initial;
    try {
      const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return zones.includes(guess) ? guess : initial;
    } catch {
      return initial;
    }
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = (() => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(new Date());
    } catch {
      return null;
    }
  })();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/v1/me/onboarding/commander', { timezone });
      /*
       * A full navigation rather than a router push. The gate that sent them
       * here runs on the SERVER, and it has to re-read their state to stop
       * sending them back — a client-side transition would reuse the cached
       * answer and bounce them straight to this page again.
       */
      window.location.href = isAdmin ? '/dashboard' : '/onboarding/verification';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.');
      setBusy(false);
    }
  }

  return (
    <div className="mt-10">
      <label htmlFor="tz" className="block text-[var(--color-text-primary)]">
        Your timezone
      </label>
      <select
        id="tz"
        value={timezone}
        disabled={busy}
        onChange={(e) => setTimezone(e.currentTarget.value)}
        className="mt-2 w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-3 text-[var(--color-text-primary)] disabled:opacity-50"
      >
        {zones.map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, ' ')}
          </option>
        ))}
      </select>

      {/*
        A live clock, because a zone name is not something most people can check.
        "Europe/London" is either right or an hour out, and the only way to know
        is to be shown the time it produces.
      */}
      {preview !== null && (
        <p className="mt-4 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3 font-mono text-sm text-[var(--color-brand-cyan-bright)]">
          {preview}
        </p>
      )}

      <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        You can change this whenever you like, under Commander Management.{' '}
        <strong className="text-[var(--color-text-primary)]">The audit log stays in UTC</strong> —
        officers in different countries need one clock to compare against.
      </p>

      {error !== null && (
        <p role="alert" className="mt-4 text-sm text-[var(--color-semantic-hostile-bright)]">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="mt-8 rounded border border-[var(--color-brand-cyan-bright)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save and continue'}
      </button>
    </div>
  );
}
