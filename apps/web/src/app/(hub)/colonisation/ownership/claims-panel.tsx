'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiDelete, apiPost } from '../../../../lib/api-client';
import { SystemPicker } from '../../../../components/system-picker';
import type { StationClaimRow } from '../../../../lib/api';

/**
 * Which stations the squadron holds, said by an officer.
 *
 * ★ THE TABLE WAS READ BY THE RANKING AND WRITTEN BY NOTHING ★
 *
 * `station_ownership_claims` shipped with the buy-location ordering and is consulted on every
 * where-to-buy query. It had no route, no service method and no screen — so the officer override
 * the schema describes at length ("it does not cover a station we hold but never built here")
 * could not be exercised by anybody. This screen is that override.
 *
 * ★ WHY AN OFFICER LIST AT ALL, WHEN OWNERSHIP IS DERIVABLE ★
 *
 * Stations the squadron BUILT through colonisation are derived from the projects table and cannot
 * go stale. That covers everything we made ourselves and needs no upkeep. It does not cover a
 * station we hold but never built here, and it cannot be corrected when the derived answer is
 * wrong. Both sources feed the ranking; a claim wins.
 */

// The shape comes from lib/api, where every other response type lives. A second declaration here
// would be a second thing to update the day the route grows a field.
export type StationClaim = StationClaimRow;

const FIELD =
  'rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] ' +
  'px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-subtle)]';

export function ClaimsPanel({ claims }: { claims: readonly StationClaim[] }) {
  const router = useRouter();
  const [stationName, setStationName] = useState('');
  const [systemName, setSystemName] = useState('');
  const [ownership, setOwnership] = useState<'squadron' | 'member'>('squadron');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost('/v1/logistics/colony/station-claims', {
        stationName,
        systemName,
        ownership,
        note: note.trim() === '' ? undefined : note,
      });
      setStationName('');
      setNote('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That claim could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (key: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/v1/logistics/colony/station-claims/${encodeURIComponent(key)}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That claim could not be withdrawn.');
    } finally {
      setBusy(false);
    }
  };

  const live = claims.filter((c) => c.withdrawnAt === null);
  const past = claims.filter((c) => c.withdrawnAt !== null);

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Station
          </span>
          <input
            value={stationName}
            onChange={(e) => setStationName(e.currentTarget.value)}
            placeholder="Wescott Platform"
            className={`${FIELD} w-[220px]`}
            required
          />
        </label>

        {/*
          A picker, not a text box, for the same reason the purchase declaration uses one: system
          names are procedurally generated and a typo produces a claim against a station that does
          not exist — which stores cleanly, lists cleanly, and changes no ordering at all.
        */}
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            System
          </span>
          <SystemPicker
            name="systemName"
            value={systemName}
            onValueChange={setSystemName}
            placeholder="its system"
            className={`${FIELD} w-[220px]`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Whose
          </span>
          <select
            value={ownership}
            onChange={(e) => setOwnership(e.currentTarget.value === 'member' ? 'member' : 'squadron')}
            className={FIELD}
          >
            <option value="squadron">The squadron&rsquo;s</option>
            <option value="member">A member&rsquo;s</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Why (optional)
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            placeholder="held since the war"
            className={`${FIELD} w-[240px]`}
          />
        </label>

        <button
          type="submit"
          disabled={busy || stationName.trim() === '' || systemName.trim() === ''}
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel)] px-4 py-2 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-active)] disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Claim it'}
        </button>
      </form>

      {error !== null && (
        <p className="m-0 text-sm text-[var(--color-semantic-hostile)]" role="alert">
          {error}
        </p>
      )}

      <section>
        <h3 className="m-0 mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)]">
          Held now
        </h3>
        {live.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-text-secondary)]">
            No claims yet. Stations the squadron built through colonisation already count as ours
            without one — this list is for the ones we hold but did not build here, and for
            correcting the derived answer when it is wrong.
          </p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {live.map((c) => (
              <li
                key={c.stationKey}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded border border-[var(--color-border-hairline)] px-3 py-2 text-sm"
              >
                <span className="text-[var(--color-text-primary)]">
                  {c.stationName}
                  <span className="ml-2 text-[11px] text-[var(--color-text-secondary)]">
                    {c.ownership === 'squadron' ? 'the squadron’s' : 'a member’s'}
                    {c.note === null ? '' : ` — ${c.note}`}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-[11px] text-[var(--color-text-dim)]">
                  {c.claimedBy ?? 'an officer'}
                  <button
                    type="button"
                    onClick={() => void withdraw(c.stationKey)}
                    disabled={busy}
                    className="rounded-sm border border-[var(--color-border-subtle)] px-2 py-1 hover:border-[var(--color-border-active)] disabled:opacity-50"
                  >
                    Withdraw
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        ★ WITHDRAWN CLAIMS ARE SHOWN, NOT HIDDEN ★

        The schema keeps them deliberately: "A deleted row would lose the argument; a dated one
        settles it." Hiding them here would lose the argument by another route — this is the one
        screen where "who said this was ours, and who took it back" is the question being asked.
        The ranking already ignores them.
      */}
      {past.length > 0 && (
        <section>
          <h3 className="m-0 mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Withdrawn
          </h3>
          <ul className="m-0 list-none space-y-1 p-0 text-sm text-[var(--color-text-secondary)]">
            {past.map((c) => (
              <li key={c.stationKey}>
                {c.stationName} — claimed by {c.claimedBy ?? 'an officer'}, withdrawn
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
