'use client';

import { useState } from 'react';
/*
 * ★ SUBPATHS, NOT THE BARREL ★
 *
 * This became a client component when the basket needed pick state, and the barrel reaches
 * node:crypto — which fails the browser build with UnhandledSchemeError and 500s EVERY hub page,
 * not just this one. `client-imports.spec.ts` caught it, which is exactly what it is for.
 */
import { depthOf } from '@grims/shared/market-depth';
import { planManifest, type Pick as ManifestPick } from '@grims/shared/manifest';
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

/** `287 Ls` close in, `1.4M Ls` for the Hutton-likes. Null stays silent — absence is not zero. */
function ls(v: number | null): string {
  if (v === null) return '';
  const text = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M Ls` : `${Math.round(v).toLocaleString()} Ls`;
  return ` · ${text}`;
}

/** Thirty days: roughly long enough for a market to have been restocked, repriced or fought over. */
const STALE_DAYS = 30;

function isStale(iso: string | null): boolean {
  if (iso === null) return true;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000 > STALE_DAYS;
}


/**
 * Supply at the pickup, demand at the destination.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "show total supply at the pickup station and total demand at the destination station please,
 * green for in demand, red for not in demand, and yellow for inbetween"
 *
 * The colour is judged against the tonnes this route would actually move, not against an absolute —
 * see `depthOf`. Four thousand tonnes of demand is generous for a Python and thin for a Cutter, and
 * one pill must not tell both of them the same thing.
 *
 * The NUMBER rides alongside the colour deliberately. A bare pill says "fine" without saying how
 * fine, and the member deciding whether to bring a second load needs the figure.
 */
function Depth({ quantity, tonnes, noun }: { quantity: number; tonnes: number; noun: string }) {
  const depth = depthOf(quantity, tonnes);

  const tone =
    depth === 'good'
      ? 'text-[var(--color-semantic-success)]'
      : depth === 'partial'
        ? 'text-[var(--color-semantic-warning)]'
        : depth === 'none'
          ? // `hostile-bright`, not `hostile`: the flat red is 3.1:1 on the panel and this is a
            // small mono figure, where the brighter tone clears AA at the size it is actually read.
            'text-[var(--color-semantic-hostile-bright)]'
          : 'text-[var(--color-text-secondary)]';

  return (
    <span className={`font-mono tabular-nums ${tone}`}>
      {depth === 'unknown' ? '—' : quantity.toLocaleString()} {noun}
    </span>
  );
}

/** A stable identity for a route, so a pick survives a re-render. */
function keyOf(r: Route): string {
  return `${r.commodity}/${r.buy.stationName}/${r.sell.stationName}`;
}


/**
 * What one ship can actually carry out of the routes a member picked.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "so we can pick multiple loads in a streamlined fashion in the freight office"
 *
 * ★ THE QUOTED PROFITS ARE ALL WRONG THE MOMENT TWO ARE PICKED ★
 *
 * Every route on the page quoted its tonnage and profit assuming the whole ship. Adding those up
 * would roughly triple the truth for three picks — so this reports what the manifest actually
 * earns, and each line says which of hold, supply, demand or credits stopped it getting more.
 */
function Basket({
  plan,
  picked,
  cargo,
  budget,
  onClear,
}: {
  plan: RoutePlan;
  picked: ReadonlySet<string>;
  cargo: number;
  budget: number | null;
  onClear: () => void;
}) {
  const chosen = plan.routes.filter((r) => picked.has(keyOf(r)));
  if (chosen.length === 0) return null;

  /*
   * Everything is sold at the FIRST pick's destination. The owner's case is several routes heading
   * to the same place; where they differ, the manifest is honest about it below rather than
   * pretending one landing empties the hold.
   */
  const destination = chosen[0]?.sell;
  const mixed = chosen.some((r) => r.sell.systemName !== destination?.systemName);

  const picks: ManifestPick[] = chosen.map((r) => ({
    commodity: r.commodity,
    buyStation: r.buy.stationName,
    buySystem: r.buy.systemName,
    sellStation: r.sell.stationName,
    sellSystem: r.sell.systemName,
    buyPrice: r.buy.price,
    profitPerTonne: r.profitPerTonne,
    supply: r.buy.quantity,
    demand: r.sell.quantity,
    buyDistanceLy: r.buy.distance ?? 0,
    buyCoords: r.buy.coords,
  }));

  const manifest = planManifest(picks, {
    // The hold every route was planned against, so the manifest and the rows agree.
    capacity: cargo,
    budget,
    origin: plan.origin?.coords ?? null,
    destination: destination?.coords ?? null,
  });

  return (
    <section className="rounded-lg border border-[var(--color-brand-orange)]/40 bg-[var(--color-surface-panel-raised)] p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 font-[family-name:var(--font-display)] text-base text-[var(--color-brand-orange-bright)]">
          Your run · {manifest.tonnes.toLocaleString()} t
        </h3>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-text-primary)]"
        >
          Clear
        </button>
      </header>

      {mixed ? (
        <p className="m-0 mb-3 text-xs text-[var(--color-semantic-warning)]">
          These do not all sell in the same system. The order below still collects them in the
          shortest way, but you will be making more than one delivery.
        </p>
      ) : null}

      <ol className="m-0 mb-3 list-none space-y-1 p-0">
        {manifest.order.map((stop, i) => (
          <li key={`${stop.commodity}/${stop.station}`} className="flex gap-3 text-sm">
            <span className="font-mono text-[var(--color-text-secondary)] tabular-nums">
              {i + 1}.
            </span>
            <span className="flex-1">
              <span className="text-[var(--color-text-primary)]">{stop.station}</span>
              <span className="text-[var(--color-text-secondary)]"> · {stop.system}</span>
            </span>
            <span className="font-mono tabular-nums text-[var(--color-text-primary)]">
              {stop.tonnes.toLocaleString()} t {stop.commodity}
            </span>
          </li>
        ))}
        <li className="flex gap-3 border-t border-[var(--color-border-hairline)] pt-1 text-sm">
          <span className="font-mono text-[var(--color-text-secondary)]">→</span>
          <span className="flex-1 text-[var(--color-brand-cyan-bright)]">
            Sell at {destination?.stationName} · {destination?.systemName}
          </span>
        </li>
      </ol>

      <p className="m-0 font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
        Outlay {manifest.outlay.toLocaleString()} cr · profit{' '}
        <span className="text-[var(--color-semantic-success)]">
          {manifest.profit.toLocaleString()} cr
        </span>
        {manifest.spare > 0 ? ` · ${manifest.spare.toLocaleString()} t of hold spare` : ''}
        {/*
          Null means the stops could not all be placed, so the order is grouped by system rather
          than routed. Said out loud, because "shortest" is a claim and we should only make it when
          it is true.
        */}
        {manifest.routeLy === null
          ? ' · grouped by system'
          : ` · ${manifest.routeLy.toLocaleString()} ly round the pickups`}
      </p>
    </section>
  );
}

export function RouteList({
  plan,
  cargo,
  budget,
}: {
  plan: RoutePlan;
  /** The hold every route on this page was planned against, so the manifest agrees with the rows. */
  cargo: number;
  budget: number | null;
}) {
  /*
   * ★ SQUADRON OWNER, 2026-08-06 ★
   *
   * "add an option to choose the trade route ... so we can group multiple routes together if there
   * are several that are going to the same destination, and show the optimized order so we can pick
   * multiple loads in a streamlined fashion"
   *
   * The picks live here and the manifest is computed in the browser. `planManifest` is a pure
   * function over data this page already holds, so a round trip to the hub would be latency buying
   * nothing — and the manifest re-plans as fast as the member can tick boxes.
   */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const toggle = (r: Route): void =>
    setPicked((was) => {
      const next = new Set(was);
      const key = keyOf(r);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
      <Basket
        plan={plan}
        picked={picked}
        cargo={cargo}
        budget={budget}
        onClear={() => setPicked(new Set())}
      />
      {/*
        The per-hour figures are estimates and say what they assume, right where they are read —
        a member in a 60 ly Anaconda reads them as pessimistic, one in a shieldless hauler as
        generous, and neither has to guess what we guessed.
      */}
      {plan.timeModel !== undefined ? (
        <p className="m-0 text-[11px] text-[var(--color-text-secondary)]">
          Run times assume a ~{plan.timeModel.jumpLy} ly laden jump, about{' '}
          {plan.timeModel.minutesPerStop} minutes per stop, and add supercruise time from each
          station's arrival distance when we hold it.
        </p>
      ) : null}
      {plan.routes.map((r) => {
        const stale = isStale(r.buy.seenAt) || isStale(r.sell.seenAt);

        return (
          <article
            key={`${r.commodity}/${r.buy.stationName}/${r.sell.stationName}`}
            className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              {/*
                The picker. A checkbox rather than a cleverer control: it is a set membership
                question, every member already knows what one does, and it is reachable by keyboard
                without anything being written to make it so.
              */}
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  checked={picked.has(keyOf(r))}
                  onChange={() => toggle(r)}
                  aria-label={`Add ${r.commodity} to the run`}
                  className="h-4 w-4 accent-[var(--color-brand-orange)]"
                />
                Add to run
              </label>
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

            <dl className="m-0 mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
              <div>
                <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  Load at
                </dt>
                <dd className="m-0 mt-1 text-sm text-[var(--color-text-primary)]">
                  {r.buy.stationName}
                </dd>
                <dd className="m-0 text-[11px] text-[var(--color-text-secondary)]">
                  {r.buy.systemName} ·{' '}
                  {r.buy.distance === null ? '—' : `${r.buy.distance.toFixed(1)} ly`}
                  {ls(r.buy.arrivalLs)} · {r.buy.price.toLocaleString()} cr/t ·{' '}
                  <Depth quantity={r.buy.quantity} tonnes={r.tonnes} noun="in stock" />
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
                  {r.sell.distance === null ? '—' : `${r.sell.distance.toFixed(1)} ly`}
                  {ls(r.sell.arrivalLs)} · {r.sell.price.toLocaleString()} cr/t ·{' '}
                  <Depth quantity={r.sell.quantity} tonnes={r.tonnes} noun="wanted" />
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

              <div>
                <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  Per hour
                </dt>
                <dd className="m-0 mt-1 font-mono text-sm text-[var(--color-text-primary)]">
                  {r.profitPerHour.toLocaleString()} cr
                </dd>
                <dd className="m-0 text-[11px] text-[var(--color-text-secondary)]">
                  ≈{r.tripMinutes} min run
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
