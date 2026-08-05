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
