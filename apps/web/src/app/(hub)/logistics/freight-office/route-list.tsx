import type { Route, RoutePlan } from '../../../../lib/api';

/**
 * The runs, best total profit first.
 *
 * ★ WHAT LIMITED THE LOAD IS ON EVERY CARD ★
 *
 * A trade tool that quotes a full hold against a station holding nine tonnes is lying with
 * arithmetic. Every route here states the tonnage it can actually move AND the reason it is not
 * more — "your hold", "supply here", "demand there", "your credits". A member who sees they are
 * carrying 44 of a possible 720 because of supply knows to look at the next route; one who sees a
 * bare 44 just thinks the tool is wrong.
 */

const CAP: Record<Route['limitedBy'], string> = {
  hold: 'your hold',
  supply: 'supply at the pickup',
  demand: 'demand at the sale',
  budget: 'your credits',
};

function ago(iso: string | null): string {
  if (iso === null) return 'never reported';
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (!Number.isFinite(days)) return 'unknown';
  if (days < 1) return `${Math.round(days * 24)}h ago`;
  if (days < 60) return `${Math.round(days)}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/** Thirty days: roughly long enough for a market to have been restocked, repriced or fought over. */
const STALE_DAYS = 30;

function isStale(iso: string | null): boolean {
  if (iso === null) return true;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000 > STALE_DAYS;
}

export function RouteList({ plan }: { plan: RoutePlan }) {
  if (plan.routes.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        Nothing profitable in range.{' '}
        {plan.considered.length > 0
          ? `We looked at ${plan.considered.length} commodit${plan.considered.length === 1 ? 'y' : 'ies'}. `
          : ''}
        Try carrying further, going further to load, or clearing the commodity.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {plan.routes.map((r) => {
        const stale = isStale(r.buy.seenAt) || isStale(r.sell.seenAt);

        return (
          <article
            key={`${r.commodity}/${r.buy.stationName}/${r.sell.stationName}`}
            className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m-0 text-base text-[var(--color-text-primary)]">
                <a
                  href={`/logistics/commodities/${encodeURIComponent(r.commodity)}`}
                  className="text-[var(--color-text-primary)] no-underline hover:underline"
                >
                  {r.commodity}
                </a>
              </h3>
              <p className="m-0 font-mono text-lg text-[var(--color-brand-cyan-bright)]">
                {r.totalProfit.toLocaleString()} cr
              </p>
            </header>

            <dl className="m-0 mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <div>
                <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  Load at
                </dt>
                <dd className="m-0 mt-1 text-sm text-[var(--color-text-primary)]">
                  {r.buy.stationName}
                </dd>
                <dd className="m-0 text-[11px] text-[var(--color-text-secondary)]">
                  {r.buy.systemName} ·{' '}
                  {r.buy.distance === null ? '—' : `${r.buy.distance.toFixed(1)} ly`} ·{' '}
                  {r.buy.price.toLocaleString()} cr/t
                </dd>
              </div>

              <div>
                <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  Sell at
                </dt>
                <dd className="m-0 mt-1 text-sm text-[var(--color-text-primary)]">
                  {r.sell.stationName}
                </dd>
                <dd className="m-0 text-[11px] text-[var(--color-text-secondary)]">
                  {r.sell.systemName} ·{' '}
                  {r.sell.distance === null ? '—' : `${r.sell.distance.toFixed(1)} ly`} ·{' '}
                  {r.sell.price.toLocaleString()} cr/t
                </dd>
              </div>

              <div>
                <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  Carrying
                </dt>
                <dd className="m-0 mt-1 font-mono text-sm text-[var(--color-text-primary)]">
                  {r.tonnes.toLocaleString()} t
                </dd>
                {/* The reason, always. See the note at the top of this file. */}
                <dd className="m-0 text-[11px] text-[var(--color-text-secondary)]">
                  capped by {CAP[r.limitedBy]}
                </dd>
              </div>

              <div>
                <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  Per tonne
                </dt>
                <dd className="m-0 mt-1 font-mono text-sm text-[var(--color-text-primary)]">
                  +{r.profitPerTonne.toLocaleString()}
                </dd>
                <dd className="m-0 text-[11px] text-[var(--color-text-secondary)]">
                  {r.outlay.toLocaleString()} cr up front · {r.distanceLy.toFixed(0)} ly total
                </dd>
              </div>
            </dl>

            {/*
              Stated whenever either end of the run is old. A route built from a price nobody has
              reported in months is a real possibility here — of the markets stocking Gold, fewer
              than a third have been seen in the last thirty days.
            */}
            {stale ? (
              <p className="m-0 mt-3 border-t border-[var(--color-border-hairline)] pt-2 text-[11px] text-[var(--color-semantic-warning)]">
                Prices last reported {ago(r.buy.seenAt)} at the pickup and {ago(r.sell.seenAt)} at
                the sale — check before you commit to the trip.
              </p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
