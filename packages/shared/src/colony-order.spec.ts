import { describe, expect, it } from 'vitest';
import { suggestBuildOrder } from './colony-order.js';
import type { SimBuildType, SimSite } from './colony-simulation.js';

/**
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * The planner already lets a member arrange the build order and already says whether an order is
 * payable. Neither says which order is GOOD.
 *
 * ★ THE PLAN THIS IS MODELLED ON ★
 *
 * Col 285 Sector GL-W c2-12: every Tier-1 feeder first (257,206 t), then the 23 Refinery Hubs that
 * produce the economy. Built that way the system sells nothing until a quarter of a million tonnes
 * have been hauled — and what it would have sold is Steel, Aluminium and Titanium, which are 68% of
 * its own remaining bill.
 *
 * The fixtures below are that shape in miniature: a feeder that earns a Tier-2 point, and a hub that
 * spends one and votes refinery.
 */

const NONE = {
  population: 0,
  maxPopulation: 0,
  security: 0,
  technology: 0,
  wealth: 0,
  standardOfLiving: 0,
  development: 0,
};

const feeder: SimBuildType = {
  id: 'hermes',
  displayName: 'Satellite Installation',
  tier: 1,
  buildClass: 'installation',
  needsTier: 0,
  needsPoints: 0,
  givesTier: 2,
  givesPoints: 1,
  requires: null,
  satisfies: [],
  effects: NONE,
  influence: 'none',
};

const hub: SimBuildType = {
  id: 'silenus',
  displayName: 'Refinery Hub',
  tier: 2,
  buildClass: 'hub',
  needsTier: 2,
  needsPoints: 1,
  givesTier: 3,
  givesPoints: 1,
  requires: null,
  satisfies: [],
  effects: NONE,
  influence: 'refinery',
};

const catalogue = new Map<string, SimBuildType>([
  ['hermes', feeder],
  ['silenus', hub],
]);

const TONNES: Record<string, number> = { hermes: 6721, silenus: 9919 };
const tonnesOf = (id: string): number => TONNES[id] ?? 0;

/** n feeders, then n hubs — the shape of the book, and the thing being fixed. */
function feedersFirst(n: number): SimSite[] {
  return [
    ...Array.from({ length: n }, (_, i) => ({ id: `f${i}`, buildTypeId: 'hermes' })),
    ...Array.from({ length: n }, (_, i) => ({ id: `h${i}`, buildTypeId: 'silenus' })),
  ];
}

describe('suggesting a build order', () => {
  it('★ MANDATORY: it pulls the first economy build forward ★', () => {
    const sites = feedersFirst(10);
    const out = suggestBuildOrder(sites, catalogue, tonnesOf);

    expect(out.firstEconomyAt.current, 'ten feeders before the first hub').toBe(10);
    expect(
      out.firstEconomyAt.suggested,
      'the primary stays put, and the first hub follows the feeder that pays for it',
    ).toBe(1);
  });

  it('★ MANDATORY: it says what that is worth in tonnes ★', () => {
    /*
     * The number is the whole argument. "A better order" persuades nobody; "your economy opens
     * 60,000 tonnes earlier" is a decision somebody can make.
     */
    const out = suggestBuildOrder(feedersFirst(10), catalogue, tonnesOf);

    expect(out.tonnesBefore.current, '10 feeders at 6,721 t').toBe(67_210);
    expect(out.tonnesBefore.suggested, 'the primary feeder only').toBe(6_721);
    expect(out.worthIt).toBe(true);
  });

  it('★ MANDATORY: the suggestion is a permutation — nothing added, nothing lost ★', () => {
    /*
     * The one property that matters more than any ordering. A suggestion that quietly dropped a
     * structure, or added one, would be worse than no suggestion — somebody would build it.
     */
    const sites = feedersFirst(8);
    const out = suggestBuildOrder(sites, catalogue, tonnesOf);

    expect(out.order).toHaveLength(sites.length);
    expect([...out.order].sort()).toEqual(sites.map((s) => s.id).sort());
  });

  it('★ MANDATORY: the primary is never moved ★', () => {
    /*
     * Position 0 is exempt from construction points, so an unconstrained optimiser puts an economy
     * build there — free economy at step one, and a suggestion the game would refuse, because what
     * claims a system is a port rather than a surface hub. It is also the member's own decision, and
     * moving it changes what every later step costs.
     */
    const sites = feedersFirst(5);
    const out = suggestBuildOrder(sites, catalogue, tonnesOf);
    expect(out.order[0], 'the top row is the claim on the system').toBe(sites[0]?.id);
  });

  it('alternates once the first hub is affordable', () => {
    // feeder, hub, feeder, hub — each feeder paying for the hub that follows it.
    const out = suggestBuildOrder(feedersFirst(4), catalogue, tonnesOf);
    expect(out.order.slice(0, 4)).toEqual(['f0', 'h0', 'f1', 'h1']);
  });

  it('MANDATORY: it stays quiet when the order is already good', () => {
    /*
     * A planner that always has advice is one people stop reading. An order that already opens the
     * economy early has nothing to gain, and saying so anyway is noise on a page somebody is trying
     * to use.
     */
    const already: SimSite[] = [
      { id: 'f0', buildTypeId: 'hermes' },
      { id: 'h0', buildTypeId: 'silenus' },
      { id: 'f1', buildTypeId: 'hermes' },
      { id: 'h1', buildTypeId: 'silenus' },
    ];
    expect(suggestBuildOrder(already, catalogue, tonnesOf).worthIt).toBe(false);
  });

  it('says nothing useful about a plan with no economy build at all', () => {
    // Feeders only. There is no economy to bring forward, and inventing advice would be worse.
    const out = suggestBuildOrder(feedersFirst(0).concat([{ id: 'f0', buildTypeId: 'hermes' }]), catalogue, tonnesOf);
    expect(out.firstEconomyAt.suggested).toBeNull();
    expect(out.worthIt).toBe(false);
  });

  it('handles an empty plan without inventing a step', () => {
    const out = suggestBuildOrder([], catalogue, tonnesOf);
    expect(out.order).toEqual([]);
    expect(out.worthIt).toBe(false);
  });

  it('leaves a slot nobody has filled in where it was', () => {
    // A placed slot with no build chosen yet costs nothing and earns nothing; it must survive.
    const sites: SimSite[] = [
      { id: 'empty', buildTypeId: null },
      { id: 'f0', buildTypeId: 'hermes' },
      { id: 'h0', buildTypeId: 'silenus' },
    ];
    const out = suggestBuildOrder(sites, catalogue, tonnesOf);
    expect(out.order).toContain('empty');
    expect(out.order).toHaveLength(3);
  });
});
