import type { MiningRing, MiningSession } from '../../../lib/api';

/**
 * The two mining tables.
 *
 * Server components: neither table sorts, filters or tabs, so there is nothing for a client bundle
 * to do. The same tokens and the same TH/TD rules as the bounty and leaderboard tables — matching
 * the existing look is a matter of using the same pieces, not of copying numbers.
 */

const TH =
  'py-3 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]';
const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';
const NUM = `${TD} text-right font-mono tabular-nums`;

/** Nothing yet is a sentence, not an empty frame that reads as broken. */
function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--color-text-secondary)]">{children}</p>;
}

function when(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Rings, richest first.
 *
 * ★ RANKED ON HIT RATE, NOT ON THE BEST ROCK EVER SEEN ★
 *
 * The question a miner has is "will my evening there be worth it", not "what is the record". A ring
 * where one 60% rock turned up among four hundred barren ones is a worse night than a steady ring
 * at 30%, and ranking on the maximum would put it first.
 */
export function RingTable({ rows }: { rows: readonly MiningRing[] }) {
  if (rows.length === 0) {
    return (
      <Nothing>
        No rings measured yet. Turn on mining telemetry in the companion app and every rock you
        prospect joins the survey — this table is built from members&rsquo; own limpets, so it fills
        as the squadron flies.
      </Nothing>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr>
            <th className={TH}>Ring</th>
            <th className={TH}>Running</th>
            <th className={`${TH} text-right`}>Worth shooting</th>
            <th className={`${TH} text-right`}>Best rock</th>
            <th className={`${TH} text-right`}>Rocks</th>
            <th className={`${TH} text-right`}>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.system}/${r.body}`}>
              <td className={TD}>
                <span className="font-medium">{r.body}</span>
                <span className="block text-xs text-[var(--color-text-secondary)]">{r.system}</span>
              </td>
              <td className={TD}>{r.topMaterial}</td>
              <td className={`${NUM} text-[var(--color-brand-cyan-bright)]`}>
                {r.hitRate.toFixed(0)}%
              </td>
              <td className={NUM}>{r.bestPercent.toFixed(1)}%</td>
              <td className={NUM}>{r.rocks.toLocaleString()}</td>
              <td className={NUM}>{when(r.lastSeen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A member's own evenings — the numbers no in-game screen keeps. */
export function SessionTable({ rows }: { rows: readonly MiningSession[] }) {
  if (rows.length === 0) {
    return (
      <Nothing>
        No mining sessions yet. Pair the companion app and turn on mining telemetry, and your rocks
        and refined tonnes are recorded here as you fly them.
      </Nothing>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] text-sm">
        <thead>
          <tr>
            <th className={TH}>Evening</th>
            <th className={TH}>Ring</th>
            <th className={`${TH} text-right`}>Rocks</th>
            <th className={`${TH} text-right`}>Worth shooting</th>
            <th className={`${TH} text-right`}>Refined</th>
            <th className={`${TH} text-right`}>Deep Core</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td className={TD}>{when(s.startedAt)}</td>
              <td className={TD}>
                {s.ring ?? '—'}
                {s.system === null ? null : (
                  <span className="block text-xs text-[var(--color-text-secondary)]">
                    {s.system}
                  </span>
                )}
              </td>
              <td className={NUM}>{s.rocks.toLocaleString()}</td>
              <td className={NUM}>
                {/*
                  A share needs rocks to divide by. A dash rather than "0%" for a session with none:
                  zero reads as "you mined badly", where the truth is "nothing to measure yet".
                */}
                {s.rocks === 0 ? '—' : `${Math.round((s.hits / s.rocks) * 100)}%`}
              </td>
              <td className={NUM}>{s.tonnes.toLocaleString()} t</td>
              <td className={`${NUM} text-[var(--color-brand-cyan-bright)]`}>
                {s.points.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
