import { depthOf } from '@grims/shared/market-depth';
import type { Circuit, CircuitPlan, Route } from '../../../../lib/api';

/**
 * Round trips — out and back, scored as one circuit.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "we want to give the ability to create round trip hauling routes! plan this out, make this
 * feature ritch!"
 *
 * ★ THE CIRCUIT'S NUMBER LEADS, NOT THE OUTBOUND'S ★
 *
 * Every figure a member compares here is for the WHOLE trip. An outbound that pays beautifully and
 * strands you with an empty hold for the way back is worse than two decent legs, and a page that
 * led with the outbound's profit would rank them the wrong way round — which is the entire reason
 * this is a separate view rather than a column on the one-way list.
 *
 * ★ A SERVER COMPONENT ★
 *
 * No picking, no state: a circuit is already a complete plan, so there is nothing for a basket to
 * combine. That keeps it out of the browser bundle entirely.
 */

const CAP: Record<Route['limitedBy'], string> = {
  hold: 'your hold',
  supply: 'supply at the pickup',
  demand: 'demand at the sale',
  budget: 'your credits',
};

function cr(n: number): string {
  return `${Math.round(n).toLocaleString()} cr`;
}

function hoursText(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Supply or demand, coloured against what this leg would actually move. */
function Depth({ quantity, tonnes, noun }: { quantity: number; tonnes: number; noun: string }) {
  const depth = depthOf(quantity, tonnes);
  const tone =
    depth === 'good'
      ? 'text-[var(--color-semantic-success)]'
      : depth === 'partial'
        ? 'text-[var(--color-semantic-warning)]'
        : depth === 'none'
          ? 'text-[var(--color-semantic-hostile-bright)]'
          : 'text-[var(--color-text-secondary)]';

  return (
    <span className={`font-mono tabular-nums ${tone}`}>
      {depth === 'unknown' ? '—' : quantity.toLocaleString()} {noun}
    </span>
  );
}

/** One leg of the circuit, drawn the same way whichever direction it is. */
function Leg({ route, label }: { route: Route; label: string }) {
  return (
    <div className="grid gap-1 border-l-2 border-[var(--color-border-hairline)] pl-3">
      <p className="m-0 flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-brand-orange-bright)]">
          {label}
        </span>
        <strong className="text-[var(--color-text-primary)]">{route.commodity}</strong>
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
          {route.tonnes.toLocaleString()} t · {cr(route.totalProfit)}
        </span>
      </p>

      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        {route.buy.stationName}{' '}
        <span className="text-[var(--color-text-primary)]">({route.buy.systemName})</span>
        {' → '}
        {route.sell.stationName}{' '}
        <span className="text-[var(--color-text-primary)]">({route.sell.systemName})</span>
      </p>

      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
        <Depth quantity={route.buy.quantity} tonnes={route.tonnes} noun="supply" />
        <Depth quantity={route.sell.quantity} tonnes={route.tonnes} noun="demand" />
        <span className="font-mono tabular-nums">{route.distanceLy.toFixed(1)} ly</span>
        {/*
          What stopped the load being bigger. A tool that quotes 44 tonnes out of a possible 720
          without saying why just looks broken; naming the cap is what makes it advice.
        */}
        <span>limited by {CAP[route.limitedBy]}</span>
      </p>
    </div>
  );
}

function CircuitCard({ circuit }: { circuit: Circuit }) {
  return (
    <article className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="m-0 text-base text-[var(--color-text-primary)]">
          {circuit.out.sell.systemName}
          <span className="text-[var(--color-text-secondary)]"> and back</span>
        </h3>
        <span className="font-mono text-sm tabular-nums text-[var(--color-semantic-success)]">
          {cr(circuit.totalProfit)}
        </span>
      </header>

      <div className="grid gap-3">
        <Leg route={circuit.out} label="Out" />

        {circuit.back === null ? (
          /*
           * ★ THE EMPTY RETURN IS SHOWN, NOT HIDDEN ★
           *
           * Dropping these would hide the best outbound run in the galaxy because nothing happened
           * to pay on the way back — and a member who is happy to deadhead home deserves to see it.
           * Saying so plainly also stops the total reading as if it included a return.
           */
          <p className="m-0 border-l-2 border-[var(--color-semantic-warning)] pl-3 text-sm text-[var(--color-semantic-warning)]">
            Nothing pays to come back — you would fly home empty. The profit above is the whole
            circuit.
          </p>
        ) : (
          <Leg route={circuit.back} label="Back" />
        )}
      </div>

      <p className="m-0 mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--color-border-hairline)] pt-3 font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
        <span className="text-[var(--color-semantic-success)]">
          {cr(circuit.profitPerHour)}/hr
        </span>
        <span>{hoursText(circuit.tripMinutes)} round trip</span>
        {/*
          The LARGER outlay, not the sum. A circuit funds itself sequentially — you sell the
          outbound before buying the return — so quoting the total would refuse circuits a member
          can comfortably fly.
        */}
        <span>{cr(circuit.capitalNeeded)} to start</span>
      </p>
    </article>
  );
}

export function CircuitList({ plan }: { plan: CircuitPlan }) {
  if (plan.circuits.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        No round trip found from here. Widening how far you will carry it, or how far from home the
        return may finish, is usually what opens this up.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {plan.circuits.map((c) => (
        <CircuitCard key={`${c.out.commodity}/${c.out.buy.stationName}/${c.back?.commodity ?? 'none'}`} circuit={c} />
      ))}

      {/*
        ★ THE SEARCH WAS BOUNDED, AND SAYS SO ★

        Every destination explored costs a full route search, so only the best few are followed. A
        member reading a short list would otherwise take it as "there is nothing better", which is a
        claim this page has not earned.
      */}
      <p className="m-0 text-xs text-[var(--color-text-secondary)]">
        Looked for a way home from the {plan.destinationsSearched} best destination
        {plan.destinationsSearched === 1 ? '' : 's'}. There may be more further out.
      </p>
    </div>
  );
}
