'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AttachedCarrier, CarrierMatch, ColonyNeed } from '../../../../lib/api';
import { apiDelete, apiGet, apiPost } from '../../../../lib/api-client';
import { CopySystem } from '../../../../components/copy-system';

/**
 * Fleet carriers helping with a build.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we also need a way to add fleet carriers to the project like raven colonial does", and
 * "squadron carriers too".
 *
 * ★ WHAT IS IN A HOLD CHANGES WHAT "REMAINING" MEANS ★
 *
 * Twenty thousand tonnes sitting on a carrier parked at the site is not the same build as twenty
 * thousand tonnes nobody has bought yet. So each commodity shows what the attached carriers are
 * already holding against what the site still wants — the one number that answers "do we need
 * another shopping trip".
 *
 * ★ AND THE READING HAS AN AGE ★
 *
 * A carrier is the one station that can be somewhere else tomorrow, so a six-month-old reading of
 * its hold is worth far less than a six-month-old reading of a starport's. The date is on every
 * row rather than implied.
 */

const CHIP =
  'rounded border border-[var(--color-border-hairline)] px-2 py-0.5 font-mono text-[10px] ' +
  'text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-active)] ' +
  'hover:text-[var(--color-text-primary)] disabled:opacity-30';

const FIELD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] ' +
  'px-3 py-1.5 text-sm text-[var(--color-text-primary)]';

function seenAgo(at: string | null): { text: string; stale: boolean } {
  if (at === null) return { text: 'never seen', stale: true };
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  const text =
    days <= 0
      ? 'seen today'
      : days === 1
        ? 'seen yesterday'
        : days < 30
          ? `seen ${days}d ago`
          : days < 365
            ? `seen ${Math.floor(days / 30)}mo ago`
            : `seen ${Math.floor(days / 365)}y ago`;
  return { text, stale: days > 30 };
}

export function Carriers({
  projectId,
  carriers,
  needs,
  canManage,
}: {
  projectId: string;
  carriers: readonly AttachedCarrier[];
  needs: readonly ColonyNeed[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState<readonly CarrierMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/v1/logistics/colony/projects/${encodeURIComponent(projectId)}/carriers`;

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      setError(null);
      setMatches(null);
      setTerm('');
      router.refresh();
    } catch (err) {
      // The hub's own sentence. "Nobody has reported that carrier's market yet" tells somebody what
      // to do next; "something went wrong" does not.
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const look = async (q: string): Promise<void> => {
    setBusy(true);
    try {
      const found = await apiGet<{ carriers: CarrierMatch[] }>(
        `${base}?q=${encodeURIComponent(q)}`,
      );
      setMatches(found.carriers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  /*
   * What the carriers cover, per commodity. Summed here rather than on the server because it is a
   * join of two things the page already has — and a member reading it can check the arithmetic
   * against the rows above it, which is the point of showing both.
   */
  const covered = new Map<string, number>();
  for (const c of carriers) {
    for (const h of c.holds) covered.set(h.commodity, (covered.get(h.commodity) ?? 0) + h.tonnes);
  }
  const outstanding = needs.filter((n) => n.remaining > 0);
  const totalCovered = outstanding.reduce(
    (sum, n) => sum + Math.min(n.remaining, covered.get(n.commodity) ?? 0),
    0,
  );
  const totalRemaining = outstanding.reduce((sum, n) => sum + n.remaining, 0);

  return (
    <div>
      {error === null ? null : (
        <p className="m-0 mb-4 rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_7%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          {error}
        </p>
      )}

      {carriers.length === 0 ? (
        <p className="m-0 mb-4 text-sm text-[var(--color-text-secondary)]">
          No carriers on this build yet. Anything a squadron carrier is already holding counts
          towards what is still needed.
        </p>
      ) : (
        <>
          <p className="m-0 mb-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
            {totalCovered.toLocaleString()} t of the {totalRemaining.toLocaleString()} t still
            wanted is already in a hold.
          </p>

          <ul className="m-0 mb-5 list-none space-y-2 p-0">
            {carriers.map((c) => {
              const age = seenAgo(c.seenAt);
              return (
                <li
                  key={c.marketId}
                  className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-sm text-[var(--color-text-primary)]">
                      {c.name}
                      {c.isSquadron ? (
                        <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-brand-orange)]">
                          squadron
                        </span>
                      ) : null}
                      <span className="ml-2 flex-wrap text-[11px] text-[var(--color-text-secondary)]">
                        {c.systemName ?? 'somewhere we have not seen'}
                      </span>
                      {c.systemName === null ? null : (
                        <CopySystem system={c.systemName} size="small" />
                      )}
                      <span
                        className={
                          age.stale
                            ? 'ml-1.5 font-mono text-[10px] text-[var(--color-semantic-warning)]'
                            : 'ml-1.5 font-mono text-[10px] text-[var(--color-text-dim)]'
                        }
                        title={
                          age.stale
                            ? 'Nobody has reported this carrier’s market recently. It may be somewhere else, and its hold may be empty.'
                            : undefined
                        }
                      >
                        {age.text}
                      </span>
                    </span>

                    <span className="flex items-center gap-3">
                      <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
                        {c.totalTonnes.toLocaleString()} t towards this build
                      </span>
                      {canManage || c.addedBy !== null ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={CHIP}
                          onClick={() => void act(() => apiDelete(`${base}/${c.marketId}`))}
                        >
                          Take off
                        </button>
                      ) : null}
                    </span>
                  </div>

                  {c.holds.length === 0 ? (
                    <p className="m-0 mt-1 text-[11px] text-[var(--color-text-dim)]">
                      {/* Distinguished on purpose. "Holding nothing this build wants" is a fact; "we
                          have never seen its market" is our own gap, and they read identically if
                          both render as an empty row. */}
                      {c.seenAt === null
                        ? 'Nobody has reported its market, so we cannot say what is aboard.'
                        : 'Nothing aboard that this build still wants.'}
                    </p>
                  ) : (
                    <ul className="m-0 mt-2 list-none space-y-0.5 p-0">
                      {c.holds.map((h) => (
                        <li
                          key={h.commodity}
                          className="flex items-baseline justify-between gap-4 text-xs text-[var(--color-text-secondary)]"
                        >
                          <span>{h.commodity}</span>
                          <span className="font-mono tabular-nums">
                            {h.tonnes.toLocaleString()} t
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="callsign, or leave blank for whoever is carrying most"
          className={`${FIELD} w-[320px]`}
        />
        <button
          type="button"
          disabled={busy}
          className={CHIP}
          onClick={() => void look(term)}
        >
          {busy ? 'Looking…' : 'Find carriers'}
        </button>
      </div>

      {matches === null ? null : matches.length === 0 ? (
        <p className="m-0 mt-3 text-sm text-[var(--color-text-secondary)]">
          No carrier we have seen is holding anything this build still wants.
        </p>
      ) : (
        <ul className="m-0 mt-3 list-none space-y-1 p-0">
          {matches.map((m) => {
            const age = seenAgo(m.seenAt);
            return (
              <li
                key={m.marketId}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[var(--color-border-hairline)] py-2 text-sm"
              >
                <span>
                  <span className="text-[var(--color-text-primary)]">{m.name}</span>
                  <span className="ml-2 text-[11px] text-[var(--color-text-secondary)]">
                    {m.systemName} · {age.text}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
                    {m.matchingTonnes.toLocaleString()} t across {m.matchingCommodities}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    className={CHIP}
                    onClick={() => void act(() => apiPost(base, { marketId: m.marketId }))}
                  >
                    Add
                  </button>
                  {canManage ? (
                    <button
                      type="button"
                      disabled={busy}
                      className={CHIP}
                      title="Add it and mark it as the squadron’s rather than a member’s own."
                      onClick={() =>
                        void act(() => apiPost(base, { marketId: m.marketId, isSquadron: true }))
                      }
                    >
                      Add as squadron
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
