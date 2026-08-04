'use client';

import { useState } from 'react';
import type { BountyLeaderboard } from '../../../lib/api';

/**
 * The Data Runner standings: this season beside all-time.
 *
 * ★ SEASON FIRST ★
 *
 * Monthly seasons exist so a member joining in November is not staring up at totals accumulated
 * since August — the running month is the race everyone is actually in, so it is the default tab.
 * All-time is the honour roll behind it.
 */

const TH =
  'py-3 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]';
const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

const TAB_ON =
  'rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-accent)]';
const TAB_OFF =
  'rounded-md border border-[var(--color-border-hairline)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50';

export function LeaderboardTables({ standings }: { standings: BountyLeaderboard }) {
  const [tab, setTab] = useState<'season' | 'allTime'>('season');
  const rows = tab === 'season' ? standings.season : standings.allTime;

  return (
    <div className="space-y-3">
      <div className="flex gap-2" role="tablist" aria-label="Leaderboard period">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'season'}
          className={tab === 'season' ? TAB_ON : TAB_OFF}
          onClick={() => setTab('season')}
        >
          Season {standings.month}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'allTime'}
          className={tab === 'allTime' ? TAB_ON : TAB_OFF}
          onClick={() => setTab('allTime')}
        >
          All-time
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">
          {tab === 'season'
            ? 'Nobody has banked a bounty yet this season. The board above is wide open.'
            : 'No bounties have ever been claimed. First name here is remembered for it.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr>
                <th className={TH}>#</th>
                <th className={TH}>Runner</th>
                <th className={`${TH} text-right`}>Points</th>
                <th className={`${TH} text-right`}>Claims</th>
                <th className={`${TH} text-right`}>Jackpots</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.handle}>
                  <td className={`${TD} font-mono text-xs`}>{i + 1}</td>
                  <td className={`${TD} font-medium`}>{r.displayName}</td>
                  <td className={`${TD} text-right font-mono`}>{r.points.toLocaleString()}</td>
                  <td className={`${TD} text-right font-mono`}>{r.claims}</td>
                  <td className={`${TD} text-right font-mono`}>
                    {r.jackpots > 0 ? r.jackpots : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
