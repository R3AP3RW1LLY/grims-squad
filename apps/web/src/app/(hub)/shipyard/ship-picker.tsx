'use client';

import { useMemo, useState } from 'react';
import type { ShipyardShipRow } from '../../../lib/api';

/**
 * Choosing a hull.
 *
 * ★ PAD SIZE FIRST, THEN PRICE ★
 *
 * A ship you cannot dock is not a ship you can fly, so the pad is the filter that rules things out
 * fastest — an outpost only takes small and medium, and somebody based at one has no use for the
 * large list at all. Price is the second question and it is on every row.
 */

const PAD_LABEL: Record<number, string> = { 1: 'Small', 2: 'Medium', 3: 'Large' };

const credits = (n: number): string =>
  n >= 1_000_000_000
    ? `${(n / 1_000_000_000).toFixed(2)} B`
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)} M`
      : `${Math.round(n / 1000)} K`;

export function ShipPicker({ ships }: { ships: ShipyardShipRow[] }) {
  const [search, setSearch] = useState('');
  const [pad, setPad] = useState<number | null>(null);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return ships
      .filter((s) => (term === '' || s.name.toLowerCase().includes(term)) && (pad === null || s.pad === pad))
      .sort((a, b) => a.hullCost - b.hullCost);
  }, [ships, search, pad]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block min-w-[220px] flex-1">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
            Ship
          </span>
          <input
            type="search"
            className="w-full rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 font-mono text-xs text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
            placeholder="Anaconda, Mandalay…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <div className="flex gap-1.5">
          {[null, 1, 2, 3].map((p) => (
            <button
              key={String(p)}
              type="button"
              onClick={() => setPad(p)}
              className={`rounded-md border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
                pad === p
                  ? 'border-[var(--color-brand-cyan)] text-[var(--color-brand-cyan-bright)]'
                  : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-subtle)]'
              }`}
            >
              {p === null ? 'Any pad' : PAD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((s) => (
          <li key={s.id}>
            <a
              href={`/shipyard?ship=${encodeURIComponent(s.id)}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3 transition-colors hover:border-[var(--color-brand-cyan)] hover:bg-[var(--color-surface-panel-hover)]"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-[var(--color-text-primary)]">{s.name}</span>
                <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                  {PAD_LABEL[s.pad] ?? 'Unknown'} pad
                </span>
              </span>
              <span className="shrink-0 font-mono text-xs text-[var(--color-brand-cyan-bright)]">
                {credits(s.hullCost)}
              </span>
            </a>
          </li>
        ))}
      </ul>

      {shown.length === 0 && (
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          No hull matches. Clear the filters to see all {ships.length}.
        </p>
      )}
    </>
  );
}
