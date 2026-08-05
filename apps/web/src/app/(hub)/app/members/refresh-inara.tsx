'use client';

import { useState } from 'react';
import { apiCall } from '../../../../lib/api-client';

/**
 * Runs the Inara commander check now.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "add a button to the admin console to trigger an inara update manually please. that way we can
 * trigger this if we need too ... pressing this should not interupt the daily job."
 *
 * ★ WHAT IT CHECKS — SQUADRON OWNER, 2026-08-05 ★
 *
 * "we have users that have updated their inara usernames ... if they have been changed they need to
 * be updated in the website, and in discord".
 *
 * It does that now, and the line under the button says so, because until 2026-08-05 it did not and
 * the button gave no clue either way. Inara is asked what each member is called NOW, using their
 * own key; a changed name is written to the roster and worn in the guild.
 *
 * ★ AND THE LINE SAYS WHO IS LEFT OUT, WHICH IS THE HARDER HALF ★
 *
 * Members who have not linked an Inara key can have their SQUADRON checked and their NAME not: the
 * lookup for them goes by the name we already hold, which is the exact thing a rename invalidates,
 * and Inara offers nothing that goes the other way. An officer pressing this and seeing somebody's
 * old name still there deserves to know why rather than to press it again.
 *
 * ★ IT REQUESTS. IT DOES NOT WAIT ★
 *
 * The audit asks Inara about every verified commander one key at a time, because `getOwnIdentity`
 * answers for a single key and cannot be batched — a hundred members is roughly fifty minutes
 * against a limit of two requests a minute. Holding an HTTP request open for that would time out
 * long before it finished, so the button says the run was ASKED FOR and the work happens in the
 * worker.
 *
 * ★ AND IT CANNOT INTERRUPT THE NIGHTLY ONE ★
 *
 * Not because this component is careful, but because both callers contend for one Postgres advisory
 * lock inside the job itself. Whichever arrives second is declined. A guard in the browser would
 * cover only the traffic that comes through this page.
 */
export function RefreshInara() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    setFailed(false);

    try {
      await apiCall('POST', '/v1/admin/squad/refresh-inara');
      /*
       * Deliberately says "asked for" rather than "done". The worker may decline it because the
       * nightly run holds the lock, and claiming a completed check that never ran is exactly the
       * kind of small lie that makes an officer stop trusting the page.
       */
      setNote('Asked for. It runs in the background, or is skipped if one is already going.');
    } catch (err) {
      setFailed(true);
      setNote(err instanceof Error ? err.message : 'That could not be requested just now.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="rounded border border-[var(--color-brand-cyan-bright)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-brand-cyan-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan)_12%,transparent)] disabled:opacity-40"
      >
        {busy ? 'Asking…' : 'Check Inara now'}
      </button>

      {/*
       * Standing text, not a result. It says what the check covers before anybody presses it, so an
       * officer who presses it and still sees an old name knows which of the two cases they are
       * looking at.
       */}
      <p className="m-0 mt-2 max-w-xs text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
        Asks Inara for each member&rsquo;s current commander name and squadron, and updates the
        roster and their Discord nickname when either has changed. Members who have not linked an
        Inara key have their squadron checked; their name is looked up by the name we already hold,
        so a rename shows up only once they link a key.
      </p>

      {note !== null && (
        <p
          className={`m-0 mt-2 max-w-xs text-[11px] leading-relaxed ${
            failed
              ? 'text-[var(--color-semantic-hostile-bright)]'
              : 'text-[var(--color-text-secondary)]'
          }`}
        >
          {note}
        </p>
      )}
    </div>
  );
}
