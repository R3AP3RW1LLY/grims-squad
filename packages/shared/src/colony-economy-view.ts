import type { PredictedCommodity, PredictedMarket } from './colony-market.js';

/**
 * What a whole system will trade, rolled up from its stations.
 *
 * ★ SQUADRON OWNER, 2026-08-11 ★
 *
 * "can we add a section on what our system will produce, and what materials the prices can be
 * affected ect, make this section all about our economy and an indepth view on everything about it"
 *
 * ★ EVERY FACT HERE WAS ALREADY COMPUTED AND NEVER SHOWN ★
 *
 * `predictMarket` has been producing per-station exports and imports since the planner shipped —
 * each commodity already carrying whether it is major or minor AND which economy in the mix put it
 * there. All of it rendered as chips buried under individual sites in the system tree. Nothing ever
 * asked the obvious question: what does the SYSTEM trade?
 *
 * So this is aggregation, not modelling. No new prediction, no new guess — the same lines, gathered
 * up and attributed back to the stations that produce them.
 *
 * ★ AND WHAT IT REFUSES TO DO ★
 *
 * It says nothing about what YOUR station will pay. Elite's prices move with supply, demand and
 * economy strength, none of which this models — so the page shows what the galaxy pays today as a
 * reference, clearly labelled, and never dresses a guess as a figure. A wrong price sends somebody
 * on a worthless run and they do not come back to check whether the tool was right.
 */

/** One commodity the system trades, and every station that trades it. */
export interface SystemTradeLine {
  readonly commodity: string;
  /** Major anywhere beats minor everywhere: the strongest claim across the stations that sell it. */
  readonly strength: 'major' | 'minor';
  /** Which economies put it on the board, deduplicated. */
  readonly economies: readonly string[];
  /** The planned stations that trade it, by site id. */
  readonly siteIds: readonly string[];
}

export interface SystemTrade {
  readonly sells: readonly SystemTradeLine[];
  readonly buys: readonly SystemTradeLine[];
  /**
   * Commodities the system both SELLS and BUYS.
   *
   * Not a contradiction and worth naming: one station exports what another imports, which is a
   * system that feeds itself and the single most useful thing on this page.
   */
  readonly internal: readonly string[];
}

/** A planned station's predicted market, as this rollup needs it. */
export interface TradeSite {
  readonly siteId: string;
  readonly market: PredictedMarket;
}

function gather(
  sites: readonly TradeSite[],
  side: 'exports' | 'imports',
): SystemTradeLine[] {
  const byCommodity = new Map<
    string,
    { strength: 'major' | 'minor'; economies: Set<string>; siteIds: string[] }
  >();

  for (const site of sites) {
    const lines: readonly PredictedCommodity[] = site.market[side];
    for (const line of lines) {
      let held = byCommodity.get(line.commodity);
      if (held === undefined) {
        held = { strength: line.strength, economies: new Set(), siteIds: [] };
        byCommodity.set(line.commodity, held);
      }
      // Major anywhere wins. A commodity one station sells heavily is a system export, whatever a
      // second station's weaker claim on it says.
      if (line.strength === 'major') held.strength = 'major';
      held.economies.add(line.fromEconomy);
      if (!held.siteIds.includes(site.siteId)) held.siteIds.push(site.siteId);
    }
  }

  return [...byCommodity.entries()]
    .map(([commodity, v]) => ({
      commodity,
      strength: v.strength,
      economies: [...v.economies].sort(),
      siteIds: v.siteIds,
    }))
    /*
     * Major first, then by how many stations trade it, then alphabetically. The first two are what
     * a member is deciding by — what this system is really FOR — and the third only exists so two
     * readings of the same plan cannot disagree about the order.
     */
    .sort(
      (a, b) =>
        (a.strength === b.strength ? 0 : a.strength === 'major' ? -1 : 1) ||
        b.siteIds.length - a.siteIds.length ||
        a.commodity.localeCompare(b.commodity),
    );
}

export function systemTrade(sites: readonly TradeSite[]): SystemTrade {
  const sells = gather(sites, 'exports');
  const buys = gather(sites, 'imports');
  const buying = new Set(buys.map((b) => b.commodity));

  return {
    sells,
    buys,
    internal: sells.filter((s) => buying.has(s.commodity)).map((s) => s.commodity).sort(),
  };
}

/** What the finished system would supply against what its own builds still need. */
export interface SelfSufficiency {
  /** Needed commodities the system will produce itself. */
  readonly covered: ReadonlyArray<{ readonly commodity: string; readonly remaining: number }>;
  /** Needed commodities nothing planned will produce. */
  readonly notCovered: ReadonlyArray<{ readonly commodity: string; readonly remaining: number }>;
  readonly coveredTonnes: number;
  readonly outstandingTonnes: number;
  /** 0–100 of outstanding tonnage the system could eventually supply. Null when nothing is needed. */
  readonly pctCovered: number | null;
}

/**
 * Which of a build's own outstanding materials the finished system would produce.
 *
 * ★ THE QUESTION UNDERNEATH THE WHOLE PLANNER ★
 *
 * A system that sells the Steel its own construction sites need stops being a place you haul to and
 * becomes a place you haul FROM. That is the difference between a fortnight of imports and a
 * fortnight of local runs, and until now nothing anywhere connected the two halves — the economy
 * model and the shopping list have never once been in the same sentence.
 *
 * Deliberately about TONNAGE, not commodity count. Covering four of seventeen materials sounds
 * meagre; covering four that happen to be 68% of the remaining tonnage is the plan paying for
 * itself, and the count alone would hide that.
 */
export function selfSufficiency(
  sells: readonly SystemTradeLine[],
  needs: ReadonlyArray<{ readonly commodity: string; readonly remaining: number }>,
): SelfSufficiency {
  const produced = new Set(sells.map((s) => s.commodity.toLowerCase()));

  const covered = needs.filter((n) => produced.has(n.commodity.toLowerCase()));
  const notCovered = needs.filter((n) => !produced.has(n.commodity.toLowerCase()));

  const coveredTonnes = covered.reduce((n, c) => n + c.remaining, 0);
  const outstandingTonnes = needs.reduce((n, c) => n + c.remaining, 0);

  const byTonnes = <T extends { remaining: number }>(rows: readonly T[]): T[] =>
    [...rows].sort((a, b) => b.remaining - a.remaining);

  return {
    covered: byTonnes(covered),
    notCovered: byTonnes(notCovered),
    coveredTonnes,
    outstandingTonnes,
    // Null rather than zero: a build with nothing outstanding is finished, not 0% self-sufficient.
    pctCovered:
      outstandingTonnes > 0 ? Math.round((coveredTonnes / outstandingTonnes) * 100) : null,
  };
}
