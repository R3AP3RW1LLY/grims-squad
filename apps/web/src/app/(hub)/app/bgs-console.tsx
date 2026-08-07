'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BgsFactionRow } from '../../../lib/api';
import { apiPost, apiDelete, ApiCallError } from '../../../lib/api-client';

/**
 * The BGS watchlist and its standing orders.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "allow the officers to choose what factions we want to be running missions for etc, give
 * instructions to the squad members etc"
 *
 * ★ THE WATCHLIST IS THE INSTRUMENT, NOT THE ORDERS ★
 *
 * Nothing scores for a faction that is not on this list. So adding one is the single most
 * consequential control on the page — it is how an officer changes what the whole squadron is
 * rewarded for — and it sits at the top rather than behind a menu.
 */

const STANCES = [
  { key: 'push', label: 'Push', help: 'Run missions for them here.' },
  { key: 'hold', label: 'Hold', help: 'Keep it steady — do not push past the ceiling.' },
  { key: 'suppress', label: 'Suppress', help: 'Work against them here.' },
  { key: 'ignore', label: 'Ignore', help: 'Not a target. Leave it alone.' },
] as const;

const STANCE_TONE: Record<string, string> = {
  push: 'text-[var(--color-semantic-success)]',
  hold: 'text-[var(--color-semantic-warning)]',
  suppress: 'text-[var(--color-semantic-hostile-bright)]',
  ignore: 'text-[var(--color-text-secondary)]',
};

const FIELD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-raised)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]';

export function BgsConsole({ factions }: { factions: BgsFactionRow[] }) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newFaction, setNewFaction] = useState('');
  const [newIsOurs, setNewIsOurs] = useState(false);

  /** Every write refreshes from the server rather than patching state — one source of truth. */
  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      router.refresh();
    } catch (err) {
      // The API's own sentence. Its refusals explain what to do — "name the system", "say why" —
      // and a generic failure would throw away the only useful thing they carry.
      setProblem(err instanceof ApiCallError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-8">
      {problem !== null ? (
        <p className="m-0 rounded border border-[var(--color-semantic-hostile-bright)] px-3 py-2 text-sm text-[var(--color-semantic-hostile-bright)]">
          {problem}
        </p>
      ) : null}

      <section>
        <h3 className="m-0 mb-2 font-[family-name:var(--font-display)] text-base">
          Back another faction
        </h3>
        <p className="m-0 mb-3 max-w-[68ch] text-sm text-[var(--color-text-secondary)]">
          Nothing scores for a faction that is not on this list — this is how you change what the
          squadron is rewarded for.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={newFaction}
            onChange={(e) => setNewFaction(e.target.value)}
            placeholder="Faction name, exactly as in game"
            className={`${FIELD} w-[22rem]`}
            aria-label="Faction name"
          />
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={newIsOurs}
              onChange={(e) => setNewIsOurs(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-brand-orange)]"
            />
            Ours
          </label>
          <button
            type="button"
            disabled={busy || newFaction.trim() === ''}
            onClick={() =>
              void run(async () => {
                await apiPost('/v1/bgs/watchlist', { name: newFaction, isOurs: newIsOurs });
                setNewFaction('');
                setNewIsOurs(false);
              })
            }
            className="rounded border border-[var(--color-brand-orange)] px-3 py-1.5 text-sm text-[var(--color-brand-orange-bright)] hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </section>

      {factions.length === 0 ? (
        <p className="m-0 text-sm text-[var(--color-text-secondary)]">
          No factions backed yet. Until one is here, the Faction Hands board scores nothing —
          deliberately, because a board that paid for any faction would reward working against us.
        </p>
      ) : (
        factions.map((f) => <FactionCard key={f.id} faction={f} busy={busy} run={run} />)
      )}
    </div>
  );
}

function FactionCard({
  faction,
  busy,
  run,
}: {
  faction: BgsFactionRow;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [stance, setStance] = useState('push');
  const [system, setSystem] = useState('');
  const [priority, setPriority] = useState('3');
  const [guidance, setGuidance] = useState('');

  // Suppress and ignore demand a reason — the API refuses without one, and the form should say so
  // before somebody has typed a system name and lost it to a rejection.
  const needsReason = stance === 'suppress' || stance === 'ignore';

  return (
    <section className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 font-[family-name:var(--font-display)] text-base">
          {faction.name}
          {faction.isOurs ? (
            <span className="ml-2 rounded border border-[var(--color-brand-orange)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-brand-orange-bright)]">
              ours
            </span>
          ) : null}
        </h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => apiDelete(`/v1/bgs/watchlist/${faction.id}`))}
          className="text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-semantic-hostile-bright)]"
        >
          Stop backing
        </button>
      </header>

      {faction.orders.length === 0 ? (
        <p className="m-0 mb-3 text-sm text-[var(--color-text-secondary)]">
          No standing orders. Members get no instruction about this faction.
        </p>
      ) : (
        <ul className="m-0 mb-3 list-none space-y-2 p-0">
          {faction.orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className={`font-mono uppercase ${STANCE_TONE[o.stance] ?? ''}`}>
                {o.stance}
              </span>
              <span className="text-[var(--color-text-primary)]">{o.systemName ?? '—'}</span>
              <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                priority {o.priority}
              </span>
              {o.guidance !== null ? (
                <span className="w-full text-xs text-[var(--color-text-secondary)]">
                  {o.guidance}
                </span>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => apiDelete(`/v1/bgs/orders/${o.id}`))}
                className="text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-text-primary)]"
              >
                Countermand
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-[var(--color-border-hairline)] pt-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
            Do what
          </span>
          <select value={stance} onChange={(e) => setStance(e.target.value)} className={FIELD}>
            {STANCES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} — {s.help}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
            Where
          </span>
          {/*
            Required, and the API refuses a name it cannot place rather than guessing. Influence is
            per-system, so an order without one is not something a member can act on.
          */}
          <input
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            placeholder="System name"
            className={`${FIELD} w-[14rem]`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
            Priority
          </span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={FIELD}>
            {['1', '2', '3', '4', '5'].map((p) => (
              <option key={p} value={p}>
                {p === '1' ? '1 — first' : p === '5' ? '5 — last' : p}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
            Why {needsReason ? '(required)' : '(optional)'}
          </span>
          <input
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder={
              needsReason
                ? 'An order to leave a faction alone gets ignored without a reason'
                : 'What members should actually do'
            }
            className={`${FIELD} w-full`}
          />
        </label>

        <button
          type="button"
          disabled={busy || system.trim() === '' || (needsReason && guidance.trim() === '')}
          onClick={() =>
            void run(async () => {
              await apiPost('/v1/bgs/orders', {
                factionId: faction.id,
                stance,
                systemName: system,
                priority: Number(priority),
                guidance,
              });
              setSystem('');
              setGuidance('');
            })
          }
          className="rounded border border-[var(--color-brand-orange)] px-3 py-1.5 text-sm text-[var(--color-brand-orange-bright)] hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] disabled:opacity-50"
        >
          Issue order
        </button>
      </div>
    </section>
  );
}
