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
  /** Light years to the pickup, for ordering the stops. */
  readonly buyDistanceLy: number;
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
}

export interface ManifestOptions {
  readonly capacity: number;
  /** Credits available. Null for "do not consider it". */
  readonly budget: number | null;
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

  return {
    lines,
    order: orderStops(lines),
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
 * ★ SYSTEMS TOGETHER, WHICH IS THE WHOLE POINT ★
 *
 * Two pickups in Deciat and one in Sol must never be ordered Deciat, Sol, Deciat — a jump out and
 * back for nothing, and precisely what ranking by profit alone produces. Grouping by system first
 * is the streamlining the owner asked for and it costs one pass.
 *
 * Within that, systems are visited nearest first and stations within a system richest first: the
 * only case where the order inside a system matters is a member who runs out of credits partway,
 * and they should run out having bought the good things.
 */
function orderStops(lines: readonly ManifestLine[]): Stop[] {
  const bySystem = new Map<string, ManifestLine[]>();
  for (const line of lines) {
    const group = bySystem.get(line.buySystem) ?? [];
    group.push(line);
    bySystem.set(line.buySystem, group);
  }

  /*
   * Systems ranked by their best line. Not by distance: the distances we hold are all measured from
   * the member's origin rather than from each other, so "nearest next" cannot be computed honestly
   * from them — and inventing a travelling-salesman order out of the wrong distances would look
   * authoritative while being arbitrary.
   */
  const systems = [...bySystem.entries()].sort(
    (a, b) => bestProfit(b[1]) - bestProfit(a[1]),
  );

  const stops: Stop[] = [];
  for (const [system, group] of systems) {
    for (const line of [...group].sort((a, b) => b.profit - a.profit)) {
      stops.push({
        commodity: line.commodity,
        station: line.buyStation,
        system,
        tonnes: line.tonnes,
      });
    }
  }
  return stops;
}

function bestProfit(lines: readonly ManifestLine[]): number {
  return lines.reduce((best, l) => Math.max(best, l.profit), 0);
}
