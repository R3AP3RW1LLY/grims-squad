'use client';

import { useState } from 'react';
import { apiCall } from '../../../../lib/api-client';

/**
 * Choosing the timezone every other time on the site renders in.
 *
 * ★ WHY THIS IS A QUESTION AND NOT A GUESS ★
 *
 * Discord's OAuth scopes carry no timezone — not on the user, not on the guild
 * member. There is nothing to import, so it is either asked for or inferred
 * from the browser.
 *
 * Inferring is what most sites do and it is wrong often enough to matter for a
 * squadron spread across Europe and North America: `Intl.DateTimeFormat()`
 * follows the DEVICE, so somebody on a work laptop in another country reads
 * every time on the site shifted. It also cannot run on the server, so every
 * timestamp would have to correct itself after the page loaded.
 *
 * Stored, it is known before the first byte of HTML.
 */
export function TimezoneForm({
  initial,
  zones,
}: {
  initial: string;
  zones: string[];
}) {
  const [timezone, setTimezone] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(next: string) {
    const previous = timezone;
    // Optimistic, reverted on failure. A select that stays where you put it
    // while the save is failing is a lie about what was stored.
    setTimezone(next);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiCall('PATCH', '/v1/me/timezone', { body: { timezone: next } });
      setSaved(true);
    } catch (e) {
      setTimezone(previous);
      setError(e instanceof Error ? e.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  /** What the member's clock says right now, in the zone they have chosen. */
  const preview = (() => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(new Date());
    } catch {
      return null;
    }
  })();

  return (
    <div>
      <label
        htmlFor="timezone"
        className="block text-sm text-[var(--color-text-primary)]"
      >
        Your timezone
      </label>
      <select
        id="timezone"
        value={timezone}
        disabled={busy}
        onChange={(e) => void save(e.currentTarget.value)}
        className="mt-2 w-full max-w-sm rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2.5 text-[var(--color-text-primary)] disabled:opacity-50"
      >
        {zones.map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, ' ')}
          </option>
        ))}
      </select>

      {/*
        A live preview, because a zone name is not something most people can
        check. "Europe/London" is either right or an hour out, and the only way
        to know is to be shown a clock.
      */}
      {preview !== null && (
        <p className="mt-3 font-mono text-sm text-[var(--color-brand-cyan-bright)]">{preview}</p>
      )}

      <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
        Every time on the site renders in this — when a device last uploaded, when you were
        verified, when an operation starts.{' '}
        <strong className="text-[var(--color-text-primary)]">The audit log is the exception</strong>
        : it is always UTC, so officers in different countries can compare the same event without
        converting anything.
      </p>

      {error !== null && (
        <p role="alert" className="mt-3 text-sm text-[var(--color-semantic-hostile-bright)]">
          {error}
        </p>
      )}
      {saved && error === null && (
        <p aria-live="polite" className="mt-3 text-sm text-[var(--color-semantic-success)]">
          Saved.
        </p>
      )}
    </div>
  );
}
