import { describe, expect, it } from 'vitest';
import { pairCircuits, type Circuit } from './round-trip.js';
import type { Route } from './routes.service.js';

/**
 * Round trips — pairing an outbound run with a way home.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "we want to give the ability to create round trip hauling routes!"
 *
 * ★ A ROUND TRIP IS NOT TWO GOOD ONE-WAY RUNS ★
 *
 * The whole difficulty is here. Taking the best run out of A and then the best run out of wherever
 * that lands is a greedy choice made blind: the outbound was picked without knowing what the
 * destination has to offer on the way back. A slightly worse outbound that ends somewhere with a
 * rich return beats it, and no amount of re-ranking a list of one-way routes can discover that —
 * the good pair was never in the list.
 *
 * So the pair is scored together, on credits per hour of the COMPLETE circuit. That is the number
 * that decides where a member spends their evening.
 */

/** A one-way route, as `planRoutes` returns it. Only the fields pairing actually reads. */
function route(
  commodity: string,
  from: string,
  to: string,
  totalProfit: number,
  tripMinutes: number,
): Route {
  const leg = (systemName: string, stationName: string) => ({
    stationName,
    systemName,
    stationType: 'Coriolis',
    largePads: 4,
    price: 1000,
    quantity: 5000,
    seenAt: new Date('2026-08-05T00:00:00Z'),
    distance: 10,
    arrivalLs: 500,
  });

  return {
    commodity,
    buy: leg(from, `${from} Dock`),
    sell: leg(to, `${to} Hub`),
    profitPerTonne: 1000,
    tonnes: Math.max(1, Math.round(totalProfit / 1000)),
    totalProfit,
    outlay: 1_000_000,
    distanceLy: 30,
    limitedBy: 'hold',
    tripMinutes,
    profitPerHour: (totalProfit / tripMinutes) * 60,
  };
}

const HOME = 'Shinrarta Dezhra';

describe('pairing an outbound run with a way home', () => {
  it('MANDATORY: the return must start where the outbound ended', () => {
    /*
     * The one rule that makes it a circuit rather than two runs. A return leaving from anywhere
     * else is a route the member cannot fly without first deadheading to its origin — which is
     * exactly the empty leg the whole feature exists to remove.
     */
    const out = [route('Gold', HOME, 'Deciat', 2_000_000, 60)];
    const back = [
      route('Tritium', 'Somewhere Else', HOME, 9_000_000, 60),
      route('Silver', 'Deciat', HOME, 1_000_000, 60),
    ];

    const circuits = pairCircuits(out, back, { home: HOME, homeWithinLy: 0 });

    expect(circuits).toHaveLength(1);
    expect(circuits[0]?.back?.commodity, 'it paired a return that starts nowhere near Deciat').toBe(
      'Silver',
    );
  });

  it('MANDATORY: ranks on the WHOLE circuit per hour, not on the outbound', () => {
    /*
     * ★ THE TEST THIS FILE EXISTS FOR ★
     *
     * The greedy answer picks the fat outbound and comes home empty. The right answer takes a
     * thinner outbound because the return more than pays for it. Any implementation that ranks
     * outbound-first fails this.
     */
    const out = [
      route('Gold', HOME, 'RichReturn', 2_000_000, 60),
      route('Painite', HOME, 'DeadEnd', 3_000_000, 60),
    ];
    const back = [
      route('Tritium', 'RichReturn', HOME, 5_000_000, 60),
      route('Scrap', 'DeadEnd', HOME, 100_000, 60),
    ];

    const circuits = pairCircuits(out, back, { home: HOME, homeWithinLy: 0 });

    // 2.0M + 5.0M = 7.0M over two hours, against 3.0M + 0.1M = 3.1M over two hours.
    expect(circuits[0]?.out.buy.systemName).toBe(HOME);
    expect(circuits[0]?.out.sell.systemName, 'it chose the fat outbound and came home poor').toBe(
      'RichReturn',
    );
    expect(circuits[0]?.totalProfit).toBe(7_000_000);
  });

  it('MANDATORY: a circuit with no way home is still offered, and says so', () => {
    /*
     * An empty return is REAL INFORMATION, not a failure. Dropping these would hide the best
     * outbound in the game because nothing happened to come back — and inventing a filler cargo to
     * fill the leg would be worse still.
     */
    const out = [route('Gold', HOME, 'Nowhere', 4_000_000, 60)];

    const circuits = pairCircuits(out, [], { home: HOME, homeWithinLy: 0 });

    expect(circuits).toHaveLength(1);
    expect(circuits[0]?.back).toBeNull();
    expect(circuits[0]?.totalProfit).toBe(4_000_000);
    expect(circuits[0]?.deadLeg, 'a one-way circuit did not admit the empty return').toBe(true);
  });

  it('MANDATORY: a real circuit outranks a one-way of the same outbound', () => {
    // Otherwise the dead-leg fallback above would quietly win and the feature would do nothing.
    const out = [route('Gold', HOME, 'Deciat', 2_000_000, 60)];
    const back = [route('Silver', 'Deciat', HOME, 10, 60)];

    const circuits = pairCircuits(out, back, { home: HOME, homeWithinLy: 0 });

    expect(circuits[0]?.back, 'the empty return beat a paying one').not.toBeNull();
  });

  it('MANDATORY: home is a radius, not an exact station', () => {
    /*
     * Insisting the return end at the precise origin discards most good circuits — a station a few
     * light years away is home for every practical purpose, and the member is going out again
     * anyway. `homeWithinLy` is the member's own tolerance.
     */
    const out = [route('Gold', HOME, 'Deciat', 2_000_000, 60)];
    const near = route('Silver', 'Deciat', 'Wolf 397', 3_000_000, 60);
    const back = [{ ...near, distanceLy: 15 }];

    const strict = pairCircuits(out, back, { home: HOME, homeWithinLy: 0 });
    const relaxed = pairCircuits(out, back, { home: HOME, homeWithinLy: 40 });

    expect(strict[0]?.back, 'a distant finish counted as home under a zero radius').toBeNull();
    expect(relaxed[0]?.back?.commodity).toBe('Silver');
  });

  it('MANDATORY: the circuit reports both legs and the true total time', () => {
    const out = [route('Gold', HOME, 'Deciat', 2_000_000, 45)];
    const back = [route('Silver', 'Deciat', HOME, 1_000_000, 75)];

    const [circuit] = pairCircuits(out, back, { home: HOME, homeWithinLy: 0 });

    expect(circuit?.tripMinutes).toBe(120);
    expect(circuit?.totalProfit).toBe(3_000_000);
    // 3,000,000 over two hours.
    expect(Math.round(circuit?.profitPerHour ?? 0)).toBe(1_500_000);
  });

  it('MANDATORY: capital is checked against the LARGER leg, not the sum', () => {
    /*
     * ★ THE MISTAKE THAT STRANDS SOMEBODY ★
     *
     * A circuit is funded sequentially: you buy the outbound, sell it, and the proceeds fund the
     * return. So the requirement is the bigger single outlay, not both added together. Summing them
     * would refuse circuits a member can comfortably fly; ignoring it entirely would recommend one
     * they cannot start.
     */
    const out = [route('Gold', HOME, 'Deciat', 2_000_000, 60)];
    const back = [route('Silver', 'Deciat', HOME, 1_000_000, 60)];

    const [circuit] = pairCircuits(out, back, { home: HOME, homeWithinLy: 0 });

    expect(circuit?.capitalNeeded).toBe(1_000_000);
  });

  it('MANDATORY: returns are ranked, so the best way home wins', () => {
    const out = [route('Gold', HOME, 'Deciat', 1_000_000, 60)];
    const back = [
      route('Silver', 'Deciat', HOME, 500_000, 60),
      route('Tritium', 'Deciat', HOME, 4_000_000, 60),
      route('Scrap', 'Deciat', HOME, 100_000, 60),
    ];

    const [circuit] = pairCircuits(out, back, { home: HOME, homeWithinLy: 0 });

    expect(circuit?.back?.commodity).toBe('Tritium');
  });

  it('MANDATORY: nothing to fly is an empty list, not a crash', () => {
    expect(pairCircuits([], [], { home: HOME, homeWithinLy: 50 })).toEqual([]);
  });

  it('MANDATORY: a circuit never pairs a leg with itself', () => {
    /*
     * A "route" from Deciat to Deciat paired as its own return would read as a circuit that never
     * leaves, and its profit would be double-counted.
     */
    const loop = route('Gold', 'Deciat', 'Deciat', 1_000_000, 60);
    const circuits: Circuit[] = pairCircuits([loop], [loop], { home: 'Deciat', homeWithinLy: 0 });

    expect(circuits[0]?.back, 'a leg was paired with itself').toBeNull();
  });
});
