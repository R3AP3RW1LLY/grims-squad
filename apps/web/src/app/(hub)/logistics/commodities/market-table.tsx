'use client';

import { useMemo, useState } from 'react';
import type { MarketRow } from '../../../../lib/api';

/**
 * Every commodity, searchable and sortable.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "shows all the comoditiy details, average pricing, price over time lots of data."
 *
 * ★ SORTED AND FILTERED IN THE BROWSER, ON PURPOSE ★
 *
 * All 391 rows arrive in one indexed read that takes single-digit milliseconds, and 391 rows is
 * nothing to sort in a browser. Paging this would put a round trip between typing a letter and
 * seeing the list narrow — the one thing a lookup table has to feel immediate about. The roster
 * pages server-side because it has to; this does not.
 */

const TH =
  'sticky top-0 z-10 bg-[var(--color-surface-panel)] py-3 pr-4 text-left font-mono text-[10px] ' +
  'uppercase tracking-[0.2em] text-[var(--color-text-secondary)]';

const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

type SortKey =
  | 'commodity'
  | 'avgBuy'
  | 'avgSell'
  | 'minBuy'
  | 'trend'
  | 'spread'
  | 'supply'
  | 'demand';

/**
 * What a commodity is worth carrying: sell high minus buy low.
 *
 * ★ AVERAGES, NOT THE EXTREMES ★
 *
 * `maxSell - minBuy` would be a bigger and much more exciting number, and it would be a lie: the
 * cheapest buy and the dearest sell are in different corners of the galaxy, and nobody flies that
 * route. The gap between the two AVERAGES is roughly what a member can expect to make per tonne
 * without planning anything, which is the honest headline for a table you skim.
 *
 * Null unless BOTH sides are known. A commodity nobody stocks has no spread — not a spread of zero,
 * which would sort it in among the genuinely worthless.
 */
function spreadOf(r: MarketRow): number | null {
  return r.avgBuy !== null && r.avgSell !== null ? r.avgSell - r.avgBuy : null;
}

const cr = (n: number | null): string =>
  n === null ? '—' : `${n.toLocaleString()}`;

/** Tonnes arrive as strings because the totals run into the billions. */
function tonnes(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return '—';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}bn`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

export function MarketTable({ rows }: { rows: readonly MarketRow[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<SortKey>('spread');

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter((c): c is string => c !== null))].sort(),
    [rows],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter(
      (r) =>
        (q === '' || r.commodity.toLowerCase().includes(q)) &&
        (category === '' || r.category === category),
    );

    /*
     * Nulls always sort LAST, whichever direction the column runs. A commodity nobody trades has no
     * price, and letting it read as zero would park every untraded good at the top of "cheapest" —
     * burying the answer under things that are not for sale at all.
     */
    const num = (v: number | null): number => (v === null ? Number.NEGATIVE_INFINITY : v);

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'commodity':
          return a.commodity.localeCompare(b.commodity);
        case 'avgBuy':
          return num(b.avgBuy) - num(a.avgBuy);
        case 'avgSell':
          return num(b.avgSell) - num(a.avgSell);
        case 'minBuy': {
          // ASCENDING — "cheapest to buy" is the one column read from the small end. Nulls still
          // sort last, which needs the opposite sentinel from every descending column.
          const asc = (v: number | null): number => (v === null ? Number.POSITIVE_INFINITY : v);
          return asc(a.minBuy) - asc(b.minBuy);
        }
        case 'trend':
          // Biggest movement either way: a 12% crash matters exactly as much as a 12% spike.
          return Math.abs(num(b.sellTrend)) - Math.abs(num(a.sellTrend));
        case 'supply':
          return Number(b.supply) - Number(a.supply);
        case 'demand':
          return Number(b.demand) - Number(a.demand);
        default:
          return num(spreadOf(b)) - num(spreadOf(a));
      }
    });
  }, [rows, query, category, sort]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search commodities…"
          aria-label="Search commodities"
          className="min-w-[220px] flex-1 rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-subtle)]"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-subtle)]"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort by"
          className="rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-subtle)]"
        >
          <option value="spread">Best margin</option>
          <option value="avgSell">Highest sell price</option>
          <option value="avgBuy">Highest buy price</option>
          <option value="minBuy">Cheapest to buy</option>
          <option value="trend">Biggest movers</option>
          <option value="supply">Most supply</option>
          <option value="demand">Most demand</option>
          <option value="commodity">Name</option>
        </select>
        <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
          {shown.length === rows.length
            ? `${rows.length} commodities`
            : `${shown.length} of ${rows.length}`}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="m-0 text-sm text-[var(--color-text-secondary)]">
          Nothing matches that. Try a shorter search, or clear the category.
        </p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-[var(--color-border-hairline)]">
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className={`${TH} pl-4`}>
                  Commodity
                </th>
                <th scope="col" className={TH}>
                  Category
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Avg buy
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Avg sell
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Margin
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Best buy
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  24h move
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Supply
                </th>
                <th scope="col" className={`${TH} pr-4 text-right`}>
                  Demand
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const spread = spreadOf(r);
                return (
                  <tr key={r.commodity} className="hover:bg-[var(--color-surface-panel)]">
                    <td className={`${TD} pl-4`}>
                      <a
                        href={`/logistics/commodities/${encodeURIComponent(r.commodity)}`}
                        className="font-medium text-[var(--color-text-primary)] no-underline hover:underline"
                      >
                        {r.commodity}
                      </a>
                    </td>
                    <td className={`${TD} text-[var(--color-text-secondary)]`}>
                      {r.category ?? '—'}
                    </td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>{cr(r.avgBuy)}</td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>{cr(r.avgSell)}</td>
                    <td
                      className={`${TD} text-right font-mono tabular-nums ${
                        spread !== null && spread > 0
                          ? 'text-[var(--color-brand-cyan-bright)]'
                          : 'text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {spread === null ? '—' : `${spread > 0 ? '+' : ''}${spread.toLocaleString()}`}
                    </td>
                    <td
                      className={`${TD} text-right font-mono tabular-nums`}
                      title="The single cheapest market anywhere — the number to beat"
                    >
                      {cr(r.minBuy)}
                    </td>
                    <td
                      className={`${TD} text-right font-mono tabular-nums ${
                        r.sellTrend === null
                          ? 'text-[var(--color-text-secondary)]'
                          : r.sellTrend >= 0
                            ? 'text-[var(--color-brand-cyan-bright)]'
                            : 'text-[var(--color-semantic-warning)]'
                      }`}
                      title="Movement in the average sell price over the last day"
                    >
                      {r.sellTrend === null
                        ? '—'
                        : `${r.sellTrend > 0 ? '▲' : r.sellTrend < 0 ? '▼' : ''} ${(Math.abs(r.sellTrend) * 100).toFixed(1)}%`}
                    </td>
                    <td
                      className={`${TD} text-right font-mono tabular-nums text-[var(--color-text-secondary)]`}
                      title={`${r.buyMarkets.toLocaleString()} markets selling it`}
                    >
                      {tonnes(r.supply)}
                    </td>
                    <td
                      className={`${TD} pr-4 text-right font-mono tabular-nums text-[var(--color-text-secondary)]`}
                      title={`${r.sellMarkets.toLocaleString()} markets buying it`}
                    >
                      {tonnes(r.demand)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
