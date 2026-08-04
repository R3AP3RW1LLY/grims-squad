import { describe, it, expect } from 'vitest';
import { movable, planRoutes, SHORTLIST } from './routes.service.js';
import type { Coords, MarketPlace, MarketRow, MarketStore, PlaceQuery } from './market.store.js';

/**
 * The Freight Office.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a trade route planner that is very granular."
 *
 * A route is a promise: fly here, spend this, earn that. What this suite protects is that the
 * promise is keepable — that the tonnage is one a member can actually load, that the second leg is
 * measured from where they will be rather than where they started, and that a loss never appears
 * dressed as a route.
 */

const HERE: Coords = { x: 0, y: 0, z: 0 };
const THERE: Coords = { x: 30, y: 0, z: 0 };

const PLACE = (over: Partial<MarketPlace> = {}): MarketPlace => ({
  stationName: 'Jameson Memorial',
  systemName: 'Shinrarta Dezhra',
  stationType: 'Orbis Starport',
  largePads: 4,
  price: 1_000,
  quantity: 10_000,
  seenAt: new Date('2026-08-01T00:00:00Z'),
  distance: 10,
  coords: THERE,
  arrivalLs: null,
  ...over,
});

function harness(opts: {
  margins?: string[];
  buys?: Record<string, MarketPlace[]>;
  sells?: Record<string, MarketPlace[]>;
}) {
  const sellQueries: PlaceQuery[] = [];

  const store: MarketStore = {
    list: async () => [] as readonly MarketRow[],
    one: async () => null,
    history: async () => [],
    topMargins: async (n) => (opts.margins ?? ['Gold']).slice(0, n),
    bestBuys: async (c) => opts.buys?.[c] ?? [PLACE()],
    bestSells: async (c, q) => {
      sellQueries.push(q);
      return opts.sells?.[c] ?? [PLACE({ price: 2_000, stationName: 'Sale Point' })];
    },
    systemCoords: async () => HERE,
    systemsLike: async () => [],
    // The planner never asks the feed's pulse — that is the controller's job, for the page banner.
    // Stubbed so the fake satisfies the interface without pretending to answer it.
    feedHealth: async () => ({ newestAt: new Date(), hoursBehind: 0, stale: false }),
  };

  return { store, sellQueries };
}

const REQ = {
  origin: HERE,
  originName: 'Sol',
  cargo: 720,
  buyWithinLy: 50,
  sellWithinLy: 100,
  budget: null,
  largePadOnly: false,
  includeCarriers: false,
  seenSince: null,
  only: null,
  sort: 'trip' as const,
};

describe('how much can actually be moved', () => {
  it('MANDATORY: takes the SMALLEST limit, not the hold size', () => {
    /*
     * The classic way a trade tool lies: quote a full hold against a station with nine tonnes on
     * the shelf. The profit is arithmetic nobody can realise, and it is the number a member plans
     * their evening around.
     */
    expect(movable({ cargo: 720, supply: 9, demand: 5_000, budget: null, buyPrice: 100 })).toEqual({
      tonnes: 9,
      limitedBy: 'supply',
    });

    expect(movable({ cargo: 720, supply: 9_000, demand: 40, budget: null, buyPrice: 100 })).toEqual({
      tonnes: 40,
      limitedBy: 'demand',
    });
  });

  it('lets a budget bind, through the buy price', () => {
    // 50,000 credits at 1,200 a tonne is 41 tonnes, not 41.67 — you cannot buy part of one.
    expect(
      movable({ cargo: 720, supply: 9_000, demand: 9_000, budget: 50_000, buyPrice: 1_200 }),
    ).toEqual({ tonnes: 41, limitedBy: 'budget' });
  });

  it('MANDATORY: a zero buy price does not divide the budget to Infinity', () => {
    /*
     * The partial index should keep `buy_price > 0` rows out entirely, so this is defence against a
     * caller that stops using it. Unguarded, the budget limit becomes Infinity — which does not
     * crash and does not show: it silently stops the budget constraining anything, and the member
     * is quoted a route they cannot pay for.
     */
    const r = movable({ cargo: 720, supply: 9_000, demand: 9_000, budget: 50_000, buyPrice: 0 });
    expect(Number.isFinite(r.tonnes)).toBe(true);
    expect(r).toEqual({ tonnes: 720, limitedBy: 'hold' });
  });

  it('reports the ship on a tie, being the limit a member can act on', () => {
    expect(
      movable({ cargo: 44, supply: 44, demand: 9_000, budget: null, buyPrice: 100 }),
    ).toEqual({ tonnes: 44, limitedBy: 'hold' });
  });

  it('never returns a negative tonnage', () => {
    // A budget under one tonne floors to zero rather than going negative and inverting the sort.
    expect(
      movable({ cargo: 720, supply: 9_000, demand: 9_000, budget: 10, buyPrice: 1_200 }).tonnes,
    ).toBe(0);
  });
});

describe('planning a run', () => {
  it('prints the same physical run once, however many ways it was found', async () => {
    // Two shortlist entries that resolve to the identical station pair — the transient duplicate
    // observed live on 2026-08-04, reproduced deliberately.
    const h = harness({
      margins: ['Silver', 'Silver'],
    });
    const plan = await planRoutes(h.store, REQ);
    const keys = plan.routes.map(
      (r) => `${r.commodity}|${r.buy.stationName}|${r.sell.stationName}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('charges a far station its supercruise leg — Hutton is one jump and ninety minutes', async () => {
    const h = harness({
      margins: ['Gold', 'Tea'],
      buys: {
        Gold: [PLACE({ arrivalLs: 300 })],
        Tea: [PLACE({ arrivalLs: 300 })],
      },
      sells: {
        Gold: [PLACE({ price: 2_000, stationName: 'Close Sale', arrivalLs: 200 })],
        Tea: [PLACE({ price: 2_000, stationName: 'Hutton-like', arrivalLs: 200_000 })],
      },
    });
    const plan = await planRoutes(h.store, REQ);
    const close = plan.routes.find((r) => r.sell.stationName === 'Close Sale');
    const far = plan.routes.find((r) => r.sell.stationName === 'Hutton-like');
    expect(close).toBeDefined();
    expect(far).toBeDefined();
    // Identical light years, very different trips: the far sale pays for its in-system leg.
    expect(far!.tripMinutes).toBeGreaterThan(close!.tripMinutes + 10);
    expect(far!.profitPerHour).toBeLessThan(close!.profitPerHour);
    // And the leg carries the number so a page can print WHY.
    expect(far!.sell.arrivalLs).toBe(200_000);
  });

  it('lets the member pick which of the three profits leads', async () => {
    /*
     * ★ SQUADRON OWNER, 2026-08-04: "Show all three, let me sort." ★
     *
     * Two commodities built to disagree: Gold moves a full hold at a thin margin (the best TRIP),
     * Tea moves six tonnes at a fat margin (the best PER TONNE). Whichever key the member picks
     * must lead — and every route must carry every number either way.
     */
    const h = harness({
      margins: ['Gold', 'Tea'],
      buys: {
        Gold: [PLACE({ price: 1_000 })],
        Tea: [PLACE({ price: 1_000, quantity: 6 })],
      },
      sells: {
        Gold: [PLACE({ price: 1_900, stationName: 'Bulk Sale' })],
        Tea: [PLACE({ price: 6_000, stationName: 'Boutique Sale' })],
      },
    });

    const byTrip = await planRoutes(h.store, REQ);
    expect(byTrip.routes[0]?.commodity).toBe('Gold'); // 900 × 720t beats 5,000 × 6t

    const byTonne = await planRoutes(h.store, { ...REQ, sort: 'tonne' });
    expect(byTonne.routes[0]?.commodity).toBe('Tea');

    // The numbers ride on every route whatever the order.
    const gold = byTonne.routes.find((r) => r.commodity === 'Gold');
    expect(gold?.profitPerHour).toBeGreaterThan(0);
    expect(gold?.tripMinutes).toBeGreaterThan(0);
  });

  it('MANDATORY: measures the second leg from the PICKUP, not from the member', () => {
    /*
     * A sale "within 100 ly" has to mean a hundred light years of CARRYING. Anchored on the origin
     * instead, the planner quotes routes that double back across everything already flown — and the
     * distance it prints would be right while the route it found was wrong.
     */
    const h = harness({ margins: ['Gold'] });

    return planRoutes(h.store, REQ).then(() => {
      expect(h.sellQueries).toHaveLength(1);
      // THERE is the buy station's own position, not HERE.
      expect(h.sellQueries[0]?.near).toEqual(THERE);
      expect(h.sellQueries[0]?.withinLy).toBe(100);
    });
  });

  it('MANDATORY: never offers a route that loses money', async () => {
    // Leg two returns the best price nearby, which can still be below what the member paid — very
    // common when the commodity is dear exactly where they are standing.
    const h = harness({
      margins: ['Gold'],
      buys: { Gold: [PLACE({ price: 5_000 })] },
      sells: { Gold: [PLACE({ price: 4_000 })] },
    });

    const { routes } = await planRoutes(h.store, REQ);

    expect(routes).toEqual([]);
  });

  it('ranks by TOTAL profit, not by margin per tonne', async () => {
    /*
     * 4,000 a tonne on a station holding six tonnes is 24,000 credits and a wasted trip. 900 a
     * tonne on one holding a full hold is 648,000. Sorting per-tonne is how a trade tool ends up
     * confidently recommending the first.
     */
    const h = harness({
      margins: ['Skimpy', 'Bulk'],
      buys: {
        Skimpy: [PLACE({ price: 1_000, quantity: 6 })],
        Bulk: [PLACE({ price: 1_000, quantity: 10_000 })],
      },
      sells: {
        Skimpy: [PLACE({ price: 5_000, quantity: 10_000 })],
        Bulk: [PLACE({ price: 1_900, quantity: 10_000 })],
      },
    });

    const { routes } = await planRoutes(h.store, REQ);

    expect(routes[0]?.commodity).toBe('Bulk');
    expect(routes[0]?.totalProfit).toBe(900 * 720);
    expect(routes[1]?.commodity).toBe('Skimpy');
  });

  it('skips a pickup whose position we do not know', async () => {
    // Its coordinates anchor leg two. Without them the sale radius would be measured from the
    // member's origin, quietly turning a 100 ly carry into something else.
    const h = harness({ margins: ['Gold'], buys: { Gold: [PLACE({ coords: null })] } });

    const { routes } = await planRoutes(h.store, REQ);

    expect(routes).toEqual([]);
    expect(h.sellQueries).toHaveLength(0);
  });

  it('honours a single named commodity instead of searching', async () => {
    // "very granular ... allow one to selct any buyable and sellable commodity" — when a member has
    // already decided, the shortlist is not consulted at all.
    const h = harness({ margins: ['Gold', 'Painite'] });

    const { considered } = await planRoutes(h.store, { ...REQ, only: 'Tritium' });

    expect(considered).toEqual(['Tritium']);
  });

  it('searches a bounded shortlist when no commodity is named', async () => {
    // The whole reason route planning is affordable: the rollup narrows 391 commodities to a dozen
    // BEFORE any per-station query runs. See the note on the four-way join that took the box down.
    const h = harness({ margins: Array.from({ length: 50 }, (_, i) => `C${i}`) });

    const { considered } = await planRoutes(h.store, REQ);

    expect(considered).toHaveLength(SHORTLIST);
  });

  it('passes the member’s filters down to BOTH legs', async () => {
    // A large-pad ship needs a large pad at each end. Applying the filter to the pickup alone is a
    // route that strands somebody at the sale.
    const h = harness({ margins: ['Gold'] });

    await planRoutes(h.store, { ...REQ, largePadOnly: true, includeCarriers: false });

    expect(h.sellQueries[0]?.largePadOnly).toBe(true);
    expect(h.sellQueries[0]?.excludeCarriers).toBe(true);
  });
});
