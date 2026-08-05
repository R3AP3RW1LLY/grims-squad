'use client';

import { useMemo, useState } from 'react';
import type { BountyRow } from '../../../lib/api';

/**
 * The two bounty tables, filterable in the browser.
 *
 * ★ FILTERED CLIENT-SIDE FOR THE SAME REASON THE MARKET TABLE IS ★
 *
 * The board is capped at five hundred rows total and arrives in one read. Typing into the filter
 * has to narrow the list between keystrokes, and a round trip per keystroke is how that dies.
 */

const TH =
  'sticky top-0 z-10 bg-[var(--color-surface-panel)] py-3 pr-4 text-left font-mono text-[10px] ' +
  'uppercase tracking-[0.2em] text-[var(--color-text-secondary)]';

const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

/**
 * How dark the data is, in the words a runner scans for.
 *
 * "Never seen" is deliberately the loudest phrase on the board: a station we hold NOTHING for is
 * worth more than any amount of staleness, and the copy has to sell that the way the points do.
 */
function ageOf(r: BountyRow): string {
  if (r.daysStale === null) return 'never seen';
  if (r.daysStale >= 365) {
    const y = r.daysStale / 365;
    return `${y.toFixed(1)}y dark`;
  }
  return `${r.daysStale}d dark`;
}

function padsOf(r: BountyRow): string {
  if (r.largePads === null || r.largePads < 0) return '—';
  return r.largePads > 0 ? `${r.largePads} large` : 'no large';
}

export function BountyBoardTables({
  rows,
  kind,
}: {
  rows: readonly BountyRow[];
  kind: 'ops' | 'galaxy';
}) {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return rows;
    return rows.filter(
      (r) =>
        r.stationName.toLowerCase().includes(q) || r.systemName.toLowerCase().includes(q),
    );
  }, [rows, query]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        {kind === 'ops'
          ? 'Nothing near our projects is past the band right now — squadron space is lit.'
          : 'No stale stations on the tail right now.'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by station or system"
        aria-label="Filter bounties by station or system"
        className="w-full max-w-sm rounded-md border border-[var(--color-border-hairline)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-semantic-warning)]"
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr>
              <th className={TH}>Station</th>
              <th className={TH}>System</th>
              <th className={TH}>Type</th>
              <th className={TH}>Pads</th>
              {kind === 'ops' ? <th className={TH}>From ops</th> : null}
              <th className={TH}>Data age</th>
              <th className={`${TH} text-right`}>Points</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.stationKey}>
                <td className={`${TD} font-medium`}>
                  {r.stationName}
                  {r.jackpot ? (
                    <span className="ml-2 rounded-sm bg-[var(--color-semantic-warning)]/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-semantic-warning)]">
                      Jackpot ×2
                    </span>
                  ) : null}
                </td>
                <td className={TD}>{r.systemName === '' ? '—' : r.systemName}</td>
                <td className={TD}>{r.stationType ?? '—'}</td>
                <td className={TD}>{padsOf(r)}</td>
                {kind === 'ops' ? (
                  <td className={TD}>
                    {r.distanceLy === null ? '—' : `${r.distanceLy.toFixed(0)} ly`}
                  </td>
                ) : null}
                <td
                  className={`${TD} ${r.daysStale === null ? 'font-semibold text-[var(--color-semantic-warning)]' : ''}`}
                >
                  {ageOf(r)}
                </td>
                <td className={`${TD} text-right font-mono`}>{r.points.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length !== rows.length ? (
        <p className="text-xs text-[var(--color-text-secondary)]">
          {shown.length} of {rows.length} bounties match.
        </p>
      ) : null}
    </div>
  );
}

/** The signed-in member's own numbers, and the board's pulse. */
export function RunnerStrip({
  me,
  computedAt,
}: {
  me: {
    monthPoints: number;
    monthClaims: number;
    allTimePoints: number;
    allTimeClaims: number;
  } | null;
  computedAt: string | null;
}) {
  const refreshed = useMemo(() => {
    if (computedAt === null) return null;
    const mins = Math.max(0, Math.round((Date.now() - Date.parse(computedAt)) / 60_000));
    return mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  }, [computedAt]);

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]/60 px-4 py-3">
      {me === null ? (
        <span className="text-sm text-[var(--color-text-secondary)]">
          Sign in and pair the companion app to run bounties — credit lands the moment you open a
          market screen.
        </span>
      ) : (
        <>
          <Stat label="This season" value={`${me.monthPoints.toLocaleString()} pts`} />
          <Stat label="Season claims" value={String(me.monthClaims)} />
          <Stat label="All-time" value={`${me.allTimePoints.toLocaleString()} pts`} />
          <Stat label="All-time claims" value={String(me.allTimeClaims)} />
        </>
      )}
      {refreshed !== null ? (
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
          Board refreshed {refreshed}
        </span>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-sm">
      <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
        {label}
      </span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}
