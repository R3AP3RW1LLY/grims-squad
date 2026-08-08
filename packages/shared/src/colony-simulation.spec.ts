import { describe, expect, it } from 'vitest';
import {
  NO_EFFECTS,
  prerequisiteName,
  simulatePlan,
  surchargedCost,
  type SimBuildType,
  type SimSite,
} from './colony-simulation.js';

/**
 * The construction-point rules, run against the sequences that actually break.
 *
 * ★ WHAT IS BEING PROVED ★
 *
 * Not that the arithmetic adds up — that a plan which the GAME would refuse is refused here, at the
 * step where it breaks, before anybody hauls a tonne to it. Every test below is a sequence a
 * squadron could plausibly write down.
 */

const build = (over: Partial<SimBuildType> & { id: string }): SimBuildType => ({
  displayName: over.id,
  tier: 1,
  buildClass: 'installation',
  needsTier: 0,
  needsPoints: 0,
  givesTier: 0,
  givesPoints: 0,
  requires: null,
  satisfies: [],
  effects: NO_EFFECTS,
  ...over,
});

/** A tier-1 orbital installation: costs nothing, earns one tier-2 point. */
const RELAY = build({
  id: 'enodia',
  displayName: 'Relay Installation',
  givesTier: 2,
  givesPoints: 1,
  satisfies: ['relay'],
});

/** A tier-2 starport: costs three tier-2 points, earns one tier-3. */
const CORIOLIS = build({
  id: 'no_truss',
  displayName: 'Coriolis Starport',
  tier: 2,
  buildClass: 'starport',
  needsTier: 2,
  needsPoints: 3,
  givesTier: 3,
  givesPoints: 1,
});

/** A tier-3 starport: costs six tier-3 points and earns nothing. */
const ORBIS = build({
  id: 'apollo',
  displayName: 'Orbis Starport',
  tier: 3,
  buildClass: 'starport',
  needsTier: 3,
  needsPoints: 6,
});

/** A tier-2 installation that needs a military settlement standing first. */
const MILITARY_INSTALLATION = build({
  id: 'vacuna',
  displayName: 'Military Installation',
  tier: 2,
  needsTier: 2,
  needsPoints: 1,
  givesTier: 3,
  givesPoints: 1,
  requires: 'settlementMilitary',
});

const MILITARY_SETTLEMENT = build({
  id: 'ioke',
  displayName: 'Military Settlement - Small',
  buildClass: 'settlement',
  givesTier: 2,
  givesPoints: 1,
  satisfies: ['settlementMilitary'],
});

const CATALOGUE = new Map(
  [RELAY, CORIOLIS, ORBIS, MILITARY_INSTALLATION, MILITARY_SETTLEMENT].map((t) => [t.id, t]),
);

const plan = (...ids: Array<string | null>): SimSite[] =>
  ids.map((buildTypeId, i) => ({ id: `s${i}`, buildTypeId }));

describe('the escalating surcharge on extra starports', () => {
  it('leaves the first two alone and escalates from the third', () => {
    /*
     * The published progression, from both sources: a tier-3 starport costs 6 points, then 12, then
     * 18. `alreadyBuilt` is how many chargeable ports came before it.
     */
    expect(surchargedCost(3, 6, 0)).toBe(6);
    expect(surchargedCost(3, 6, 1)).toBe(6);
    expect(surchargedCost(3, 6, 2)).toBe(6);
    expect(surchargedCost(3, 6, 3)).toBe(12);
    expect(surchargedCost(3, 6, 4)).toBe(18);
  });

  it('truncates the tier-2 surcharge rather than rounding it', () => {
    /*
     * ★ THE ONE PLACE ROUNDING WOULD GIVE A DIFFERENT ANSWER ★
     *
     * Tier 2 escalates 3 → 5 → 7. As a multiplier that is +75% per step, but only if it is
     * TRUNCATED: 3 + trunc(3 × 0.75 × 1) = 3 + 2 = 5, and 3 + trunc(3 × 0.75 × 2) = 3 + 4 = 7.
     * Rounding instead gives 3 → 5 → 8, which would tell a squadron they cannot afford a third
     * port that the game would let them build.
     */
    expect(surchargedCost(2, 3, 3)).toBe(5);
    expect(surchargedCost(2, 3, 4)).toBe(7);
  });
});

describe('running a build order', () => {
  it('charges nothing for the primary port', () => {
    // A Coriolis as the first station in a system costs 3 points it has no way to have earned.
    // The game exempts it, and a simulation that did not would call every real plan illegal.
    const result = simulatePlan(plan('no_truss'), CATALOGUE);

    expect(result.steps[0]?.isPrimary).toBe(true);
    expect(result.steps[0]?.spend).toBeNull();
    expect(result.problems).toEqual([]);
    // It still EARNS its tier-3 point.
    expect(result.tier3).toBe(1);
  });

  it('refuses a starport the plan cannot pay for, at the step it breaks', () => {
    const result = simulatePlan(plan('enodia', 'no_truss'), CATALOGUE);

    // One relay earns one tier-2 point. A Coriolis wants three.
    expect(result.steps[1]?.tier2).toBe(-2);
    expect(result.steps[1]?.problems[0]?.kind).toBe('points');
    expect(result.steps[1]?.problems[0]?.message).toContain('2 short');
  });

  it('accepts the same builds in a workable order', () => {
    /*
     * ★ THE WHOLE ARGUMENT FOR SIMULATING IN ORDER ★
     *
     * Identical set of builds, one more relay. Three relays earn three tier-2 points, which is
     * exactly what the Coriolis costs. Nothing about the totals changed except the sequence.
     */
    const result = simulatePlan(plan('enodia', 'enodia', 'enodia', 'no_truss'), CATALOGUE);

    expect(result.problems).toEqual([]);
    expect(result.tier2).toBe(0);
    expect(result.tier3).toBe(1);
  });

  it('will not let a plan pay for something with points it earns later', () => {
    // Coriolis first, relays after. The totals balance; the plan still cannot be built.
    const later = simulatePlan(plan('enodia', 'no_truss', 'enodia', 'enodia'), CATALOGUE);

    expect(later.tier2).toBe(0);
    expect(later.problems).toHaveLength(1);
    expect(later.problems[0]?.kind).toBe('points');
  });

  it('counts the primary toward what the NEXT port is charged', () => {
    /*
     * The exemption is from the CHARGE, not from the count. A plan with a primary Orbis and three
     * more must see the surcharge start on the one the game treats as the fourth port — otherwise
     * the planner tells somebody the third is affordable and the game disagrees.
     */
    const enough = Array.from({ length: 40 }, () => 'enodia');
    const result = simulatePlan(
      plan('apollo', ...enough, 'no_truss', 'no_truss', 'no_truss'),
      CATALOGUE,
    );

    const ports = result.steps.filter((s) => s.buildTypeId === 'no_truss');
    expect(ports.map((p) => p.spend?.points)).toEqual([3, 3, 5]);
    expect(ports.map((p) => p.surcharge)).toEqual([0, 0, 2]);
    expect(result.surchargedPorts).toBe(1);
  });
});

describe('prerequisites', () => {
  it('refuses a build whose prerequisite is not in the plan at all', () => {
    const result = simulatePlan(plan('enodia', 'ioke', 'vacuna'), CATALOGUE);
    expect(result.problems).toEqual([]);

    const without = simulatePlan(plan('enodia', 'enodia', 'vacuna'), CATALOGUE);
    expect(without.problems[0]?.kind).toBe('prerequisite');
    expect(without.problems[0]?.message).toContain('a military settlement');
  });

  it('refuses one whose prerequisite comes LATER in the order', () => {
    /*
     * The subtle failure, and the reason this checks what is earlier rather than what exists. A
     * plan holding both builds looks complete; built in this sequence the second one cannot start.
     */
    const result = simulatePlan(plan('enodia', 'enodia', 'vacuna', 'ioke'), CATALOGUE);

    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.kind).toBe('prerequisite');
  });

  it('names the prerequisite in words a member can act on', () => {
    expect(prerequisiteName('settlementMilitary')).toBe('a military settlement');
    // An unknown key still says something honest rather than rendering an internal identifier.
    expect(prerequisiteName('somethingNew')).toContain('somethingNew');
  });
});

describe('slots nobody has filled in', () => {
  it('counts them as costing and earning nothing, and says so', () => {
    const result = simulatePlan(plan('enodia', null), CATALOGUE);

    expect(result.steps[1]?.spend).toBeNull();
    expect(result.steps[1]?.earn).toBeNull();
    expect(result.steps[1]?.problems[0]?.kind).toBe('unchosen');
    // The balance is unchanged by an empty slot rather than reset by it.
    expect(result.tier2).toBe(1);
  });

  it('does not silently drop a build it has never heard of', () => {
    /*
     * A plan referencing a build type the catalogue does not hold would otherwise sum as though it
     * were free — the planner quietly approving something it cannot actually cost.
     */
    const result = simulatePlan(plan('nothing-we-know'), CATALOGUE);
    expect(result.problems[0]?.kind).toBe('unchosen');
    expect(result.problems[0]?.message).toContain('catalogue');
  });
});

describe('what the finished system would be', () => {
  it('totals the effects of everything in the order', () => {
    const scored = build({
      id: 'scored',
      effects: {
        population: 3,
        maxPopulation: 2,
        security: -4,
        technology: 5,
        wealth: 6,
        standardOfLiving: 1,
        development: 7,
      },
    });
    const catalogue = new Map([[scored.id, scored]]);

    const result = simulatePlan(plan('scored', 'scored'), catalogue);

    // Security is routinely negative for a large port, and it must stay negative rather than being
    // floored — a plan that costs the system its security is exactly what somebody needs told.
    expect(result.effects).toEqual({
      population: 6,
      maxPopulation: 4,
      security: -8,
      technology: 10,
      wealth: 12,
      standardOfLiving: 2,
      development: 14,
    });
  });
});

/**
 * What economy the plan actually produces.
 *
 * ★ THE OUTPUT THE BUILD BOOKS LEAN ON AND THE APP DID NOT SHOW ★
 *
 * A colonisation plan's most consequential result is not its point balance or its tonnage — it is
 * what the system BECOMES. Two plans with identical costs and identical effect totals can produce
 * a refinery or an extraction site depending only on which influences outnumber which, and a
 * member could not see that anywhere in the website or the app.
 *
 * It is also the one decision that cannot be taken back: a build carrying `fixed`, placed first,
 * sets the economy permanently. That rule is enforced by `checkColonyPlan` and the tally here has
 * to agree with it exactly, or the two halves of the same page contradict each other.
 */
describe('the economy a plan produces', () => {
  const infl = (id: string, influence: string | null, fixed: string | null = null): SimBuildType =>
    build({ id, influence, fixed, givesTier: 2, givesPoints: 1 });

  it('counts every influence in the order and names the leader as primary', () => {
    const catalogue = new Map(
      [infl('a', 'hightech'), infl('b', 'hightech'), infl('c', 'industrial')].map((t) => [t.id, t]),
    );

    const { economy } = simulatePlan(plan('a', 'b', 'c'), catalogue);

    expect(economy.counts).toEqual({ hightech: 2, industrial: 1 });
    expect(economy.primary).toBe('hightech');
    expect(economy.secondary).toBe('industrial');
    expect(economy.locked).toBe(false);
  });

  it('ignores builds that carry no economy at all', () => {
    // `none` is a real value in the catalogue, not a missing one, and counting it would invent a
    // fictional economy that outvotes the real ones.
    const catalogue = new Map(
      [infl('a', 'none'), infl('b', null), infl('c', 'refinery')].map((t) => [t.id, t]),
    );

    const { economy } = simulatePlan(plan('a', 'b', 'c'), catalogue);

    expect(economy.counts).toEqual({ refinery: 1 });
    expect(economy.primary).toBe('refinery');
    expect(economy.secondary).toBeNull();
  });

  it('★ MANDATORY: a fixed build placed FIRST locks the economy, whatever the counts say ★', () => {
    /*
     * The whole reason this is worth showing. Eight high-tech influences lose to one industrial
     * one, because the industrial build opened the plan. A member who cannot see this hauls a
     * fortnight of cargo to a system that will never be what they intended.
     */
    const catalogue = new Map(
      [infl('vulcan', 'industrial', 'industrial'), infl('a', 'hightech'), infl('b', 'hightech')].map(
        (t) => [t.id, t],
      ),
    );

    const { economy } = simulatePlan(plan('vulcan', 'a', 'b'), catalogue);

    expect(economy.locked).toBe(true);
    expect(economy.lockedBy).toBe('vulcan');
    expect(economy.primary).toBe('industrial');
    // The votes are still counted and still reported — they just no longer decide.
    expect(economy.counts).toEqual({ industrial: 1, hightech: 2 });
  });

  it('treats a fixed build placed LATER as an ordinary vote', () => {
    const catalogue = new Map(
      [infl('a', 'hightech'), infl('b', 'hightech'), infl('vulcan', 'industrial', 'industrial')].map(
        (t) => [t.id, t],
      ),
    );

    const { economy } = simulatePlan(plan('a', 'b', 'vulcan'), catalogue);

    expect(economy.locked).toBe(false);
    expect(economy.lockedBy).toBeNull();
    expect(economy.primary).toBe('hightech');
  });

  it('breaks a tie by name, so the panel does not change on a redraw', () => {
    const catalogue = new Map([infl('a', 'refinery'), infl('b', 'industrial')].map((t) => [t.id, t]));

    const { economy } = simulatePlan(plan('a', 'b'), catalogue);

    expect(economy.primary).toBe('industrial');
    expect(economy.secondary).toBe('refinery');
  });

  it('reports nothing at all for an empty order', () => {
    const { economy } = simulatePlan([], new Map());

    expect(economy.counts).toEqual({});
    expect(economy.primary).toBeNull();
    expect(economy.secondary).toBeNull();
    expect(economy.locked).toBe(false);
  });
});
