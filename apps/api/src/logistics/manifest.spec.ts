import { describe, expect, it } from 'vitest';
import { planManifest, type Pick } from './manifest.js';

/**
 * Several routes, one ship, one hold.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "add an option to choose the trade route ... so we can group multiple routes together if there
 * are several that are going to the same destination, and show the optimized order so we can pick
 * multiple loads in a streamlined fashion"
 *
 * ★ THE HOLD IS THE CONSTRAINT, AND IT IS WHAT MAKES THIS HARD ★
 *
 * Picking three routes does not mean three runs — the owner chose one ship splitting its hold. So
 * the tonnages the individual routes quoted are all wrong the moment a second route is picked:
 * each assumed the whole ship. What has to be decided is how much of a finite hold each commodity
 * deserves, and that is an allocation problem, not a sum.
 *
 * Credits bind it too. A member with forty million cannot fill seven hundred tonnes with Painite,
 * and a manifest that ignored that would be a shopping list they cannot pay for.
 */

const pick = (
  commodity: string,
  buySystem: string,
  profitPerTonne: number,
  opts: Partial<Pick> = {},
): Pick => ({
  commodity,
  buyStation: `${buySystem} Dock`,
  buySystem,
  sellStation: 'Sirius Atmos',
  sellSystem: 'Sirius',
  buyPrice: 1_000,
  profitPerTonne,
  supply: 100_000,
  demand: 100_000,
  buyDistanceLy: 10,
  ...opts,
});

describe('filling one hold from several routes', () => {
  it('MANDATORY: the richest commodity gets the hold first', () => {
    /*
     * With a finite ship, "which of these do I actually carry" is the whole question. Splitting the
     * hold evenly would leave profit on the pad for no reason.
     */
    const out = planManifest([pick('Painite', 'Deciat', 4_000), pick('Gold', 'Sol', 1_000)], {
      capacity: 100,
      budget: null,
    });

    expect(out.lines[0]?.commodity).toBe('Painite');
    expect(out.lines[0]?.tonnes).toBe(100);
    // Nothing left for the second, and it is dropped rather than listed at zero tonnes.
    expect(out.lines).toHaveLength(1);
  });

  it('MANDATORY: the click order does not decide who gets the hold', () => {
    /*
     * The mutation that proved this was untested: every other case here happened to list the
     * richest pick first, so dropping the sort changed nothing. A member clicks routes in the order
     * they appear on screen, which is whatever they sorted by — and if that decided the allocation,
     * picking the cheap one first would hand it the whole ship.
     */
    const out = planManifest(
      [pick('Gold', 'Sol', 1_000), pick('Painite', 'Deciat', 4_000)],
      { capacity: 100, budget: null },
    );

    expect(out.lines[0]?.commodity, 'the hold went to whichever was clicked first').toBe('Painite');
    expect(out.profit).toBe(400_000);
  });

  it('MANDATORY: what is left over goes to the next best', () => {
    const out = planManifest(
      [
        pick('Painite', 'Deciat', 4_000, { supply: 60 }),
        pick('Gold', 'Sol', 1_000),
      ],
      { capacity: 100, budget: null },
    );

    expect(out.lines[0]).toMatchObject({ commodity: 'Painite', tonnes: 60 });
    expect(out.lines[1]).toMatchObject({ commodity: 'Gold', tonnes: 40 });
    expect(out.tonnes).toBe(100);
  });

  it('MANDATORY: never more than the station has, or than the buyer wants', () => {
    /*
     * Supply and demand are both hard caps and they are different stations. A manifest that ignored
     * either would send a member to buy tonnes that are not there, or to sell tonnes nobody takes.
     */
    const tight = planManifest([pick('Painite', 'Deciat', 4_000, { supply: 30, demand: 10 })], {
      capacity: 500,
      budget: null,
    });

    expect(tight.lines[0]?.tonnes).toBe(10);
  });

  it('MANDATORY: credits are a cap, and the outlay is reported', () => {
    /*
     * A manifest a member cannot pay for is a shopping list, not a plan. 40 tonnes at 1,000 is all
     * twenty million buys — the rest of the hold stays empty and the plan says so.
     */
    const out = planManifest([pick('Painite', 'Deciat', 4_000, { buyPrice: 500_000 })], {
      capacity: 700,
      budget: 20_000_000,
    });

    expect(out.lines[0]?.tonnes).toBe(40);
    expect(out.outlay).toBe(20_000_000);
  });

  it('MANDATORY: a hold that cannot be filled is honest about it', () => {
    const out = planManifest([pick('Painite', 'Deciat', 4_000, { supply: 12 })], {
      capacity: 700,
      budget: null,
    });

    expect(out.tonnes).toBe(12);
    expect(out.spare, 'the empty space in the hold was not reported').toBe(688);
  });

  it('MANDATORY: total profit is what the manifest actually earns, not the quoted sum', () => {
    /*
     * ★ THE NUMBER EVERY NAIVE VERSION GETS WRONG ★
     *
     * Each picked route quoted a profit assuming it had the whole ship. Adding those quotes would
     * roughly triple the truth for three picks — and it would be the headline figure on the page.
     */
    const out = planManifest(
      [pick('Painite', 'Deciat', 4_000, { supply: 60 }), pick('Gold', 'Sol', 1_000)],
      { capacity: 100, budget: null },
    );

    // 60 × 4,000 + 40 × 1,000, not (100 × 4,000) + (100 × 1,000).
    expect(out.profit).toBe(280_000);
  });
});

describe('the order to fly it in', () => {
  it('MANDATORY: pickups in the same system are visited together', () => {
    /*
     * The streamlining the owner asked for. Two stations in Deciat and one in Sol should never be
     * ordered Deciat, Sol, Deciat — that is a wasted jump each way, and it is exactly what sorting
     * by profit alone produces.
     */
    const out = planManifest(
      [
        pick('Painite', 'Deciat', 4_000, { buyStation: 'Garay Terminal', supply: 30 }),
        pick('Gold', 'Sol', 3_000, { supply: 30 }),
        pick('Silver', 'Deciat', 2_000, { buyStation: 'Brorsen Hub', supply: 30 }),
      ],
      { capacity: 200, budget: null },
    );

    const systems = out.order.map((stop) => stop.system);
    const first = systems.indexOf('Deciat');
    const last = systems.lastIndexOf('Deciat');

    expect(last - first, 'the route left Deciat and came back to it').toBe(1);
  });

  it('MANDATORY: every picked line appears exactly once in the order', () => {
    const out = planManifest(
      [
        pick('Painite', 'Deciat', 4_000, { supply: 30 }),
        pick('Gold', 'Sol', 3_000, { supply: 30 }),
        pick('Silver', 'Wolf 359', 2_000, { supply: 30 }),
      ],
      { capacity: 200, budget: null },
    );

    expect(out.order).toHaveLength(3);
    expect(new Set(out.order.map((s) => s.commodity)).size).toBe(3);
  });

  it('MANDATORY: a line allocated no tonnes is not a stop', () => {
    // Flying to a station to collect nothing is the clearest possible waste.
    const out = planManifest(
      [pick('Painite', 'Deciat', 4_000), pick('Gold', 'Sol', 1_000)],
      { capacity: 50, budget: null },
    );

    expect(out.order.map((s) => s.commodity)).toEqual(['Painite']);
  });

  it('MANDATORY: nothing picked is an empty manifest, not a crash', () => {
    const out = planManifest([], { capacity: 700, budget: null });

    expect(out.lines).toEqual([]);
    expect(out.order).toEqual([]);
    expect(out.profit).toBe(0);
  });
});
