/**
 * Several routes, one ship, one hold.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "add an option to choose the trade route and display them in the overlay please so we can group
 * multiple routes together if there are several that are going to the same destination, and show
 * the optimized order so we can pick multiple loads in a streamlined fashion"
 *
 * ★ THE HOLD IS THE CONSTRAINT ★
 *
 * Picking three routes is not three runs — it is one ship carrying three things. Which means every
 * tonnage the individual routes quoted is wrong the moment a second is picked: each of them assumed
 * the whole ship to itself. What is left to decide is how much of a finite hold each commodity
 * deserves, and that is an allocation, not a sum.
 *
 * The failure this exists to prevent is the headline number. Adding up what each route promised
 * would roughly triple the truth for three picks, and it would be the biggest text on the page.
 *
 * ★ PURE, SO THE ARITHMETIC CAN BE ARGUED WITH ★
 *
 * Finding the routes is the market store's job and already indexed. Everything here is the
 * reasoning about them, which is where the mistakes live and none of which needs a database.
 */

/** One route a member has picked, as the planner needs it. */
export interface Pick {
  readonly commodity: string;
  readonly buyStation: string;
  readonly buySystem: string;
  readonly sellStation: string;
  readonly sellSystem: string;
  readonly buyPrice: number;
  readonly profitPerTonne: number;
  /** Tonnes available at the pickup. A hard cap. */
  readonly supply: number;
  /** Tonnes wanted at the destination. A different station, and a different hard cap. */
  readonly demand: number;
  /** Light years to the pickup, as the market measured it FROM THE MEMBER. */
  readonly buyDistanceLy: number;
  /**
   * Where the pickup's system actually is.
   *
   * ★ THE REASON THE ORDER CAN BE A REAL SHORTEST PATH ★
   *
   * `buyDistanceLy` is measured from the member, not between stops, so it cannot order them. These
   * coordinates can. Null for a system we have not resolved — a provisional station, usually — and
   * one null is enough to abandon the path entirely rather than compute a confident wrong one.
   */
  readonly buyCoords?: Coords | null | undefined;
}

/** A point in the galaxy. The same shape the market store returns. */
export interface Coords {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** How much of one commodity the manifest carries, and what it costs and earns. */
export interface ManifestLine {
  readonly commodity: string;
  readonly tonnes: number;
  readonly outlay: number;
  readonly profit: number;
  readonly buyStation: string;
  readonly buySystem: string;
  /** What stopped this line getting more of the hold — the most useful thing the page can say. */
  readonly limitedBy: 'hold' | 'supply' | 'demand' | 'budget';
}

/** One stop on the run, in the order to fly it. */
export interface Stop {
  readonly commodity: string;
  readonly station: string;
  readonly system: string;
  readonly tonnes: number;
}

export interface Manifest {
  readonly lines: readonly ManifestLine[];
  readonly order: readonly Stop[];
  readonly tonnes: number;
  readonly outlay: number;
  readonly profit: number;
  /** Hold left empty. Shown, because "you could carry 700 and are carrying 44" explains itself. */
  readonly spare: number;
  /**
   * Light years for the whole circuit, when every stop could be placed.
   *
   * Null means the order is grouped by system rather than routed — either no origin was given, or
   * a system could not be placed. Null rather than a guess, so the page can say which it is.
   */
  readonly routeLy: number | null;
}

export interface ManifestOptions {
  readonly capacity: number;
  /** Credits available. Null for "do not consider it". */
  readonly budget: number | null;
  /** Where the member is starting. Without it there is no path to optimise, only a grouping. */
  readonly origin?: Coords | null | undefined;
  /** Where everything is being sold. The fixed far end of the path. */
  readonly destination?: Coords | null | undefined;
}

export function planManifest(picks: readonly Pick[], opts: ManifestOptions): Manifest {
  const capacity = Math.max(0, Math.floor(opts.capacity));

  /*
   * ★ RICHEST PER TONNE FIRST ★
   *
   * With a finite hold, every tonne given to a cheaper commodity is a tonne taken from a dearer
   * one. Splitting evenly, or honouring the order the member happened to click in, leaves profit on
   * the pad for nothing.
   */
  const ranked = [...picks].sort((a, b) => b.profitPerTonne - a.profitPerTonne);

  const lines: ManifestLine[] = [];
  let holdLeft = capacity;
  let creditsLeft = opts.budget;

  for (const p of ranked) {
    if (holdLeft <= 0) break;

    const affordable =
      creditsLeft === null || p.buyPrice <= 0
        ? Number.POSITIVE_INFINITY
        : Math.floor(creditsLeft / p.buyPrice);

    const caps = [
      { by: 'hold' as const, at: holdLeft },
      { by: 'supply' as const, at: Math.max(0, Math.floor(p.supply)) },
      { by: 'demand' as const, at: Math.max(0, Math.floor(p.demand)) },
      { by: 'budget' as const, at: affordable },
    ];

    const tightest = caps.reduce((a, b) => (b.at < a.at ? b : a));
    const tonnes = tightest.at;

    // A line carrying nothing is not a line. It would put a stop on the route for no cargo.
    if (!Number.isFinite(tonnes) || tonnes <= 0) continue;

    const outlay = tonnes * p.buyPrice;
    lines.push({
      commodity: p.commodity,
      tonnes,
      outlay,
      profit: tonnes * p.profitPerTonne,
      buyStation: p.buyStation,
      buySystem: p.buySystem,
      limitedBy: tightest.by,
    });

    holdLeft -= tonnes;
    if (creditsLeft !== null) creditsLeft -= outlay;
  }

  const routed = routeStops(lines, picks, opts);

  return {
    lines,
    order: routed.stops,
    routeLy: routed.lengthLy,
    tonnes: lines.reduce((n, l) => n + l.tonnes, 0),
    outlay: lines.reduce((n, l) => n + l.outlay, 0),
    /*
     * What the manifest ACTUALLY earns. Never the sum of what the picked routes each quoted, which
     * assumed a whole ship apiece and would be several times this.
     */
    profit: lines.reduce((n, l) => n + l.profit, 0),
    spare: Math.max(0, capacity - lines.reduce((n, l) => n + l.tonnes, 0)),
  };
}

/**
 * The order to collect them in.
 *
 * ★ A REAL SHORTEST PATH WHEN WE CAN, GROUPING WHEN WE CANNOT ★
 *
 * Every distance the market reports is measured from the MEMBER, not between the stops, so it
 * cannot order them. Coordinates can — and we hold them for every system — so with an origin and a
 * destination the stops become a small travelling-salesman problem with both ends pinned.
 *
 * Small is doing real work there. A hold fills from a handful of routes, so exhaustive search over
 * the permutations is exact and instant; past `EXACT_LIMIT` it falls back to nearest-neighbour,
 * which is a good order rather than a proven one.
 *
 * ★ ONE MISSING COORDINATE ABANDONS THE WHOLE PATH ★
 *
 * A provisional station's system may not be placed yet. Treating that as the origin — or as
 * anywhere — produces a confident, wrong route, which is worse than an honest grouping. So the
 * whole thing reverts and `routeLy` is null, which is what lets the page say which it did.
 */

/** Above this many stops, exhaustive search stops being instant. 6! = 720; 8! = 40,320. */
const EXACT_LIMIT = 7;

function distance(a: Coords, b: Coords): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function routeStops(
  lines: readonly ManifestLine[],
  picks: readonly Pick[],
  opts: ManifestOptions,
): { stops: Stop[]; lengthLy: number | null } {
  const stops = lines.map((line) => {
    const source = picks.find(
      (p) => p.commodity === line.commodity && p.buyStation === line.buyStation,
    );
    return {
      commodity: line.commodity,
      station: line.buyStation,
      system: line.buySystem,
      tonnes: line.tonnes,
      coords: source?.buyCoords ?? null,
      profit: line.profit,
    };
  });

  const origin = opts.origin ?? null;
  const destination = opts.destination ?? null;
  const placed = stops.every((s) => s.coords !== null);

  // No ends to pin, or a stop we cannot place: group by system and say nothing about distance.
  if (origin === null || destination === null || !placed || stops.length > EXACT_LIMIT) {
    return { stops: groupBySystem(stops), lengthLy: null };
  }

  const best = shortestOrder(
    stops.map((s) => ({ ...s, coords: s.coords as Coords })),
    origin,
    destination,
  );

  return {
    stops: best.order.map(({ commodity, station, system, tonnes }) => ({
      commodity,
      station,
      system,
      tonnes,
    })),
    lengthLy: Math.round(best.lengthLy),
  };
}

/** Exhaustive, with both ends pinned. Exact for the handful of stops one hold can carry. */
function shortestOrder<T extends { coords: Coords }>(
  stops: readonly T[],
  origin: Coords,
  destination: Coords,
): { order: T[]; lengthLy: number } {
  let bestOrder: T[] = [...stops];
  let bestLength = Number.POSITIVE_INFINITY;

  const walk = (chosen: T[], rest: readonly T[]): void => {
    if (rest.length === 0) {
      let length = 0;
      let at = origin;
      for (const stop of chosen) {
        length += distance(at, stop.coords);
        at = stop.coords;
      }
      length += distance(at, destination);

      if (length < bestLength) {
        bestLength = length;
        bestOrder = [...chosen];
      }
      return;
    }

    for (let i = 0; i < rest.length; i += 1) {
      const next = rest[i] as T;
      walk([...chosen, next], [...rest.slice(0, i), ...rest.slice(i + 1)]);
    }
  };

  walk([], stops);
  return { order: bestOrder, lengthLy: bestLength };
}

/**
 * The fallback: systems together, best-first.
 *
 * Two pickups in Deciat and one in Sol must never be ordered Deciat, Sol, Deciat — a jump out and
 * back for nothing, and exactly what ranking by profit alone produces.
 */
function groupBySystem<T extends { system: string; profit: number }>(stops: readonly T[]): Stop[] {
  const bySystem = new Map<string, T[]>();
  for (const stop of stops) {
    const group = bySystem.get(stop.system) ?? [];
    group.push(stop);
    bySystem.set(stop.system, group);
  }

  const systems = [...bySystem.entries()].sort(
    (a, b) => bestProfit(b[1]) - bestProfit(a[1]),
  );

  const out: Stop[] = [];
  for (const [, group] of systems) {
    for (const stop of [...group].sort((a, b) => b.profit - a.profit)) {
      const s = stop as unknown as Stop;
      out.push({
        commodity: s.commodity,
        station: s.station,
        system: s.system,
        tonnes: s.tonnes,
      });
    }
  }
  return out;
}

function bestProfit(stops: readonly { profit: number }[]): number {
  return stops.reduce((best, s) => Math.max(best, s.profit), 0);
}
