import type { Coords, MarketPlace, MarketStore } from './market.store.js';

/**
 * The Freight Office — planning a hauling run.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a trade route planner that is very granular and will allow one to selct any buyable and sellable
 * commodity / mineable etc this will be its own system." The name is theirs, picked from a
 * shortlist: it reads as a PLACE you go to get work, matching Shipyard → Outfitter.
 *
 * ★ LEG BY LEG, BECAUSE THE OTHER WAY TOOK THE MACHINE DOWN ★
 *
 * The natural expression of "find me a profitable round trip" is a join of buy-side against
 * sell-side across every commodity. On 2026-07-31 a four-way self-join over this data spilled to
 * temp until it exhausted the disk and stopped the Docker engine — it is why `market_entries` was
 * flattened out of JSONB in the first place, and the migration that created it says so.
 *
 * So this never joins. It narrows, then walks:
 *
 *   1. The hourly rollup picks the commodities worth carrying — 391 pre-aggregated rows, 2ms.
 *   2. For each, the best places to BUY near the member, on the partial index. ~8ms each.
 *   3. For each of those, the best places to SELL near THAT STATION. ~8ms each.
 *
 * Every step rides an index and returns a bounded number of rows, so the cost is a few dozen small
 * queries rather than one enormous one. It is also the shape a member actually thinks in: I am
 * here, what do I load, and where do I take it.
 */

export interface RouteRequest {
  readonly origin: Coords;
  readonly originName: string;
  /** Tonnes the hull can carry. Decides the total, and is the number members get wrong most often. */
  readonly cargo: number;
  /** How far the member will go to pick up. */
  readonly buyWithinLy: number;
  /** How far they will carry it once loaded. */
  readonly sellWithinLy: number;
  /** Credits available. A route they cannot afford to fill is not a route. */
  readonly budget: number | null;
  readonly largePadOnly: boolean;
  readonly includeCarriers: boolean;
  /** Ignore prices nobody has reported since this. */
  readonly seenSince: Date | null;
  /** Plan for one commodity only, rather than searching for the best. */
  readonly only: string | null;
}

export interface RouteLeg {
  readonly stationName: string;
  readonly systemName: string;
  readonly stationType: string | null;
  readonly largePads: number;
  readonly price: number;
  readonly quantity: number;
  readonly seenAt: Date | null;
  /** Light years from the previous point of the run. */
  readonly distance: number | null;
}

export interface Route {
  readonly commodity: string;
  readonly buy: RouteLeg;
  readonly sell: RouteLeg;
  readonly profitPerTonne: number;
  /** Tonnes actually movable: the smallest of hold, supply, demand and what the budget affords. */
  readonly tonnes: number;
  readonly totalProfit: number;
  readonly outlay: number;
  /** Total light years: out to the pickup, then on to the sale. */
  readonly distanceLy: number;
  /**
   * What limited the load. Shown, because "you could carry 720 and are carrying 44" is the single
   * most useful thing this page can say, and a bare number never explains itself.
   */
  readonly limitedBy: 'hold' | 'supply' | 'demand' | 'budget';
}

/** How many commodities to consider when the member has not named one. */
export const SHORTLIST = 12;
/** How many pickup points to explore per commodity. */
const BUY_CANDIDATES = 3;
/** How many sale points to consider per pickup. */
const SELL_CANDIDATES = 3;

/**
 * How much can actually be moved, and what stopped it being more.
 *
 * ★ THE HONEST TONNAGE, NOT THE HOLD SIZE ★
 *
 * A route quoting a full hold against a station with nine tonnes on the shelf is the classic way a
 * trade tool lies: the profit is arithmetic nobody can realise. Every constraint that can bind is
 * applied, and the tightest one is reported by name.
 */
export function movable(input: {
  readonly cargo: number;
  readonly supply: number;
  readonly demand: number;
  readonly budget: number | null;
  readonly buyPrice: number;
}): { tonnes: number; limitedBy: Route['limitedBy'] } {
  // Ordered so that on a tie the EARLIER, more fundamental limit is reported. A member whose hold
  // and the shelf both hold exactly 44 tonnes is limited by their ship, which is the actionable one.
  const limits: Array<[Route['limitedBy'], number]> = [
    ['hold', input.cargo],
    ['supply', input.supply],
    ['demand', input.demand],
  ];

  /*
   * Budget only binds when one was given, and only through the BUY price — the sale pays for
   * itself. Guarded against a zero price, which would divide to Infinity and quietly stop the
   * budget constraining anything at all.
   */
  if (input.budget !== null && input.buyPrice > 0) {
    limits.push(['budget', Math.floor(input.budget / input.buyPrice)]);
  }

  let best: [Route['limitedBy'], number] = limits[0] as [Route['limitedBy'], number];
  for (const limit of limits) if (limit[1] < best[1]) best = limit;

  return { tonnes: Math.max(0, best[1]), limitedBy: best[0] };
}

function leg(p: MarketPlace): RouteLeg {
  return {
    stationName: p.stationName,
    systemName: p.systemName,
    stationType: p.stationType,
    largePads: p.largePads,
    price: p.price,
    quantity: p.quantity,
    seenAt: p.seenAt,
    distance: p.distance,
  };
}

export interface RouteReport {
  readonly routes: readonly Route[];
  /** Commodities considered, so the page can say how wide the search was. */
  readonly considered: readonly string[];
}

export async function planRoutes(
  store: MarketStore,
  req: RouteRequest,
  limit = 15,
): Promise<RouteReport> {
  const considered =
    req.only !== null && req.only !== ''
      ? [req.only]
      : [...(await store.topMargins(SHORTLIST))];

  const base = {
    excludeCarriers: !req.includeCarriers,
    largePadOnly: req.largePadOnly,
    seenSince: req.seenSince,
    minQuantity: 1,
  };

  const routes: Route[] = [];

  for (const commodity of considered) {
    const buys = await store.bestBuys(commodity, {
      ...base,
      limit: BUY_CANDIDATES,
      near: req.origin,
      withinLy: req.buyWithinLy,
    });

    for (const buy of buys) {
      /*
       * Leg two is anchored on the PICKUP STATION, not on where the member started. A sale "within
       * 100 ly" has to mean a hundred light years of carrying — measuring it from the origin would
       * quote routes that double back across everything already flown.
       */
      if (buy.coords === null) continue;

      const sells = await store.bestSells(commodity, {
        ...base,
        limit: SELL_CANDIDATES,
        near: buy.coords,
        withinLy: req.sellWithinLy,
      });

      for (const sell of sells) {
        const profitPerTonne = sell.price - buy.price;
        // Losing money is not a route. Cheap to check and it removes most of what leg two returns
        // when a commodity is dearer where the member is standing than anywhere nearby.
        if (profitPerTonne <= 0) continue;

        const { tonnes, limitedBy } = movable({
          cargo: req.cargo,
          supply: buy.quantity,
          demand: sell.quantity,
          budget: req.budget,
          buyPrice: buy.price,
        });
        if (tonnes <= 0) continue;

        routes.push({
          commodity,
          buy: leg(buy),
          sell: leg(sell),
          profitPerTonne,
          tonnes,
          totalProfit: profitPerTonne * tonnes,
          outlay: buy.price * tonnes,
          distanceLy: (buy.distance ?? 0) + (sell.distance ?? 0),
          limitedBy,
        });
      }
    }
  }

  /*
   * Total profit, not profit per tonne. A 4,000-a-tonne margin on a station holding six tonnes is a
   * worse trip than 900 a tonne on one holding a full hold, and per-tonne sorting is how trade
   * tools end up recommending the first.
   */
  routes.sort((a, b) => b.totalProfit - a.totalProfit);

  return { routes: routes.slice(0, limit), considered };
}
