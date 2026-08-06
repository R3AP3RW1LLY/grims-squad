import type { Route } from './routes.service.js';

/**
 * Round trips — pairing an outbound run with a way home.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "we want to give the ability to create round trip hauling routes! ... make this feature ritch"
 *
 * ★ WHY THIS IS NOT JUST TWO CALLS TO planRoutes ★
 *
 * Taking the best run out of A, then the best run out of wherever that lands, is a greedy choice
 * made blind. The outbound gets picked without knowing what its destination offers on the way back,
 * so a slightly thinner outbound that ends somewhere rich never gets considered — and no amount of
 * re-ranking a list of one-way routes can recover it, because the good pair was never in the list.
 *
 * So the pair is scored together, on credits per hour of the COMPLETE circuit.
 *
 * ★ PURE, AND SEPARATE FROM THE QUERIES ★
 *
 * Fetching candidate legs is the market store's job and already indexed. What is left is the
 * reasoning — which return belongs to which outbound, what counts as home, what to do when there
 * is no way back, and how much capital a circuit really needs. That is where the bugs live, and
 * none of it needs a database.
 */

export interface CircuitOptions {
  /** The system the member is starting from and wants to end near. */
  readonly home: string;
  /**
   * How far from home the return may finish and still count as home.
   *
   * Insisting on the exact origin discards most good circuits: a station a few light years out is
   * home for every practical purpose, and the member is heading out again anyway.
   */
  readonly homeWithinLy: number;
}

export interface Circuit {
  readonly out: Route;
  /** The way home. Null when nothing pays to come back — see `deadLeg`. */
  readonly back: Route | null;
  /** True when the return is empty. Stated rather than hidden: an empty leg is real information. */
  readonly deadLeg: boolean;
  readonly totalProfit: number;
  readonly tripMinutes: number;
  readonly profitPerHour: number;
  /**
   * Credits needed to START the circuit.
   *
   * The LARGER single outlay, not the sum. A circuit funds itself sequentially — you buy the
   * outbound, sell it, and the proceeds pay for the return — so summing them would refuse circuits
   * a member can comfortably fly.
   */
  readonly capitalNeeded: number;
}

/** Same normalisation the rest of logistics uses for system names off different sources. */
function sameSystem(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Does this return finish close enough to home?
 *
 * `distanceLy` on the return leg is measured from where that run STARTED, which is the outbound's
 * destination — so it is not the distance home. The honest test we can make from the data we have
 * is: it ends at home, or it ends within the member's tolerance of where they began.
 */
function finishesNearHome(back: Route, opts: CircuitOptions): boolean {
  if (sameSystem(back.sell.systemName, opts.home)) return true;
  if (opts.homeWithinLy <= 0) return false;
  return back.distanceLy <= opts.homeWithinLy;
}

/**
 * Pair every outbound with its best available return.
 *
 * Returns one circuit per outbound — including the ones with no way home — ranked by credits per
 * hour of the whole circuit.
 */
export function pairCircuits(
  outbound: readonly Route[],
  returns: readonly Route[],
  opts: CircuitOptions,
): Circuit[] {
  const circuits: Circuit[] = [];

  for (const out of outbound) {
    const destination = out.sell.systemName;

    let best: Route | null = null;
    for (const back of returns) {
      // The rule that makes it a circuit: the way home must LEAVE from where the outbound landed.
      if (!sameSystem(back.buy.systemName, destination)) continue;

      /*
       * Never pair a leg with itself. A run whose buy and sell are the same system would otherwise
       * match its own destination, read as a circuit that never leaves, and double-count its
       * profit.
       */
      if (back === out) continue;

      if (!finishesNearHome(back, opts)) continue;

      if (best === null || back.totalProfit > best.totalProfit) best = back;
    }

    /*
     * A circuit with no return is still offered. Dropping it would hide the best outbound run in
     * the game because nothing happened to come back — and filling the leg with an invented cargo
     * would be worse. The member is told the leg is empty and can decide.
     */
    const totalProfit = out.totalProfit + (best?.totalProfit ?? 0);
    const tripMinutes = out.tripMinutes + (best?.tripMinutes ?? 0);

    circuits.push({
      out,
      back: best,
      deadLeg: best === null,
      totalProfit,
      tripMinutes,
      // Guarded: a zero-minute circuit would render as "Infinity cr/hr" on a page read at a glance.
      profitPerHour: tripMinutes > 0 ? (totalProfit / tripMinutes) * 60 : 0,
      capitalNeeded: Math.max(out.outlay, best?.outlay ?? 0),
    });
  }

  /*
   * ★ RANKED ON THE WHOLE CIRCUIT ★
   *
   * Not on the outbound, which is the greedy answer this function exists to beat. Ties break toward
   * the shorter circuit: same money, less flying.
   */
  circuits.sort((a, b) =>
    b.profitPerHour !== a.profitPerHour
      ? b.profitPerHour - a.profitPerHour
      : a.tripMinutes - b.tripMinutes,
  );

  return circuits;
}
