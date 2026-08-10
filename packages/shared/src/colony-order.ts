import { simulatePlan, type SimBuildType, type SimSite } from './colony-simulation.js';

/**
 * The order that gets a system EARNING soonest.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * The planner has always let a member arrange the build order by hand, and the simulation says
 * whether an order is payable. Neither of them says which order is GOOD.
 *
 * ★ THE COST OF GETTING IT WRONG, MEASURED ON A REAL PLAN ★
 *
 * Col 285 Sector GL-W c2-12 is 81 structures and 1,065,059 tonnes, laid out as every Tier-1 feeder
 * first (257,206 t) and then the 23 Refinery Hubs that actually produce the economy. Built in that
 * order the system sells nothing until a quarter of a million tonnes have been hauled.
 *
 * Alternated instead — feeder, hub, feeder, hub — the first Refinery Hub lands after about 16,600 t
 * and the system starts producing what the rest of the build needs to BUY. On that plan the
 * squadron's own market opens roughly 240,000 tonnes earlier, which is the difference between
 * hauling Steel in from outside for a fortnight and buying it at home.
 *
 * ★ WHAT IT OPTIMISES FOR, AND WHAT IT REFUSES TO DO ★
 *
 * Earliest economy, subject to the plan staying payable at every step. It never reorders into a
 * negative balance, never moves a build ahead of a prerequisite it needs, and never drops or adds a
 * site — the output is a permutation of the input and nothing else. A suggestion that quietly
 * changed what somebody was building would be worse than no suggestion.
 *
 * ★ AND IT IS A SUGGESTION ★
 *
 * It returns an order and the reason it is better. It does not apply it. The member's own order may
 * encode things this cannot see — a body they want finished first, a carrier already parked
 * somewhere — and a planner that silently rearranged a fortnight of work would be one nobody trusts
 * twice.
 */

export interface OrderSuggestion {
  /** The proposed order, as site ids. Always a permutation of the input. */
  readonly order: readonly string[];
  /** Step index at which an economy-influencing build first lands, in each order. */
  readonly firstEconomyAt: { readonly current: number | null; readonly suggested: number | null };
  /** Tonnage hauled before that step, in each order — the number that makes the case. */
  readonly tonnesBefore: { readonly current: number; readonly suggested: number };
  /** True when the suggestion is worth showing at all. */
  readonly worthIt: boolean;
}

/** How much earlier the economy must arrive before it is worth interrupting somebody. */
const MEANINGFUL_TONNES = 10_000;

/**
 * Whether a build votes for an economy.
 *
 * `none` is a real catalogue value meaning "no vote" and is treated exactly like null — the
 * distinction matters to the catalogue and not to this.
 */
function votes(build: SimBuildType | undefined): boolean {
  const influence = build?.influence ?? null;
  return influence !== null && influence !== 'none';
}

/**
 * Where the first economy-influencing build sits, and what has been hauled to reach it.
 *
 * ★ TONNAGE COMES IN, IT IS NOT ON THE BUILD TYPE ★
 *
 * `SimBuildType` carries what the SIMULATION needs — points, tiers, prerequisites — and not what a
 * thing weighs. Passing a lookup keeps it that way rather than widening a type used by the whole
 * planner so this one function can add up freight.
 */
function economyArrival(
  order: readonly SimSite[],
  catalogue: ReadonlyMap<string, SimBuildType>,
  tonnesOf: (buildTypeId: string) => number,
): { at: number | null; tonnesBefore: number } {
  let tonnes = 0;

  for (let i = 0; i < order.length; i += 1) {
    const site = order[i];
    const id = site?.buildTypeId ?? null;
    const build = id === null ? undefined : catalogue.get(id);

    if (votes(build)) return { at: i, tonnesBefore: tonnes };
    tonnes += id === null ? 0 : tonnesOf(id);
  }

  return { at: null, tonnesBefore: tonnes };
}

/** Whether an order is payable the whole way down — no step ever going tier-negative. */
function payable(order: readonly SimSite[], catalogue: ReadonlyMap<string, SimBuildType>): boolean {
  const result = simulatePlan(order, catalogue);
  return result.steps.every((s) => s.tier2 >= 0 && s.tier3 >= 0 && s.problems.length === 0);
}

/**
 * A better order, or the same one.
 *
 * ★ GREEDY, AND DELIBERATELY NOT CLEVER ★
 *
 * At each step it takes the earliest still-unplaced site that keeps the plan payable, preferring an
 * economy build whenever one can be afforded. That is not provably optimal and does not need to be:
 * the win here is structural — stop hauling a quarter of a million tonnes before the first producing
 * building — and a search that took a minute to shave another few hundred tonnes off would be a
 * worse tool for somebody deciding what to fly tonight.
 *
 * It also keeps the member's relative order among equals, so the result reads like their plan with
 * the economy pulled forward rather than like a list somebody else wrote.
 */
export function suggestBuildOrder(
  sites: readonly SimSite[],
  catalogue: ReadonlyMap<string, SimBuildType>,
  tonnesOf: (buildTypeId: string) => number = () => 0,
): OrderSuggestion {
  const current = economyArrival(sites, catalogue, tonnesOf);

  /*
   * ★ THE PRIMARY NEVER MOVES — CAUGHT BY A TEST, 2026-08-10 ★
   *
   * Position 0 is exempt from construction points: "the first station in a system is what claims
   * it, and the game charges no construction points for it". Left free to reorder, this happily put
   * a Refinery Hub there — free economy at step one, and a suggestion the game would refuse, since
   * what claims a system is a port and not a surface hub.
   *
   * It is also the member's own decision about which structure claims their system, and moving it
   * silently changes what every later step costs. So the top row is theirs and the optimiser starts
   * at the second.
   */
  const primary = sites.length > 0 ? [sites[0] as SimSite] : [];
  const remaining = sites.slice(1);
  const chosen: SimSite[] = [...primary];

  const isEconomy = (site: SimSite): boolean =>
    votes(site.buildTypeId === null ? undefined : catalogue.get(site.buildTypeId));

  while (remaining.length > 0) {
    /*
     * An economy build first if one is payable right now, otherwise the earliest site that is —
     * which is what naturally interleaves the feeders that pay for them.
     */
    let pick = remaining.findIndex(
      (site) => isEconomy(site) && payable([...chosen, site], catalogue),
    );

    if (pick === -1) {
      pick = remaining.findIndex((site) => payable([...chosen, site], catalogue));
    }

    /*
     * Nothing is payable from here. That is a plan the member has to fix rather than one this can
     * reorder — so the rest is appended untouched and the simulation will say why, in their own
     * order, where they put it.
     */
    if (pick === -1) {
      chosen.push(...remaining);
      break;
    }


    const [taken] = remaining.splice(pick, 1);
    if (taken !== undefined) chosen.push(taken);
  }

  const suggested = economyArrival(chosen, catalogue, tonnesOf);

  /*
   * Worth showing only when it actually moves the economy earlier by a meaningful amount. A
   * suggestion that saves four hundred tonnes is noise on a page somebody is trying to read, and a
   * planner that always has advice is one people stop reading.
   */
  const worthIt =
    suggested.at !== null &&
    (current.at === null || suggested.tonnesBefore + MEANINGFUL_TONNES <= current.tonnesBefore);

  return {
    order: chosen.map((s) => s.id),
    firstEconomyAt: { current: current.at, suggested: suggested.at },
    tonnesBefore: { current: current.tonnesBefore, suggested: suggested.tonnesBefore },
    worthIt,
  };
}
