import { describe, expect, it } from 'vitest';
import { valueHold, type SellQuote } from './mining-valuation.js';

/**
 * What the hold is worth, and where to take it.
 *
 * ★ THE THING NO OTHER MINING TOOL CAN DO ★
 *
 * EDMiner and its kind can show what you mined. None of them can tell you what it is worth or where
 * to sell it, because none of them own a market database. This squadron does — eighteen million
 * rows — so the overlay can answer the question a miner actually has at the end of a session.
 *
 * ★ THE ARITHMETIC IS SEPARATE FROM THE QUERY ON PURPOSE ★
 *
 * Finding the best station is `bestSells`, already written and already indexed. What is left is
 * deciding what to do with the answers: which station to name when the materials disagree, what to
 * do about a mineral nobody is buying, and how to price a hold when only part of it has a market.
 * That reasoning is where the bugs live, and none of it needs a database to test.
 */

const quote = (
  material: string,
  perTonne: number,
  station: string,
  system: string,
  distanceLy: number | null,
  demand = 10_000,
): SellQuote => ({ material, perTonne, station, system, distanceLy, demand });

describe('pricing a hold', () => {
  it('MANDATORY: values each material at its own best price', () => {
    const out = valueHold({ Painite: 100, Platinum: 50 }, [
      quote('Painite', 500_000, 'Jameson Memorial', 'Shinrarta Dezhra', 12),
      quote('Platinum', 300_000, 'Jameson Memorial', 'Shinrarta Dezhra', 12),
    ]);

    expect(out.value).toBe(100 * 500_000 + 50 * 300_000);
  });

  it('MANDATORY: a mineral nobody is buying is worth nothing, not a guess', () => {
    /*
     * No quote means no market we can see — not a price of zero to be averaged in, and certainly
     * not a made-up one. The hold value has to be a number a member could actually collect.
     */
    const out = valueHold({ Painite: 100, Bauxite: 40 }, [
      quote('Painite', 500_000, 'Jameson Memorial', 'Shinrarta Dezhra', 12),
    ]);

    expect(out.value).toBe(100 * 500_000);
    expect(out.unpriced, 'the unsellable mineral was silently dropped').toContain('Bauxite');
  });

  it('MANDATORY: an empty hold is worth nothing and names no station', () => {
    const out = valueHold({}, []);

    expect(out.value).toBe(0);
    expect(out.bestSale).toBeNull();
  });

  it('MANDATORY: material names match however they are spelled', () => {
    /*
     * The journal says "Low Temperature Diamonds"; the market table says "lowtemperaturediamonds".
     * Matching them literally would price the single most valuable mineral in the game at zero.
     */
    const out = valueHold({ 'Low Temperature Diamonds': 10 }, [
      quote('lowtemperaturediamonds', 800_000, 'Rescue Ship', 'Sol', 3),
    ]);

    expect(out.value).toBe(8_000_000);
  });
});

describe('choosing the station to name', () => {
  it('MANDATORY: names the station that pays most for the WHOLE hold, not per mineral', () => {
    /*
     * ★ THE DECISION THIS SERVICE EXISTS TO MAKE ★
     *
     * A miner lands once and sells everything. A station paying a fortune for the four tonnes of
     * Alexandrite and nothing for the two hundred tonnes of Painite is the wrong answer, even
     * though it tops the per-mineral list. Ranking by what the actual hold would fetch there is the
     * only ranking that matches what the member does next.
     */
    const out = valueHold({ Painite: 200, Alexandrite: 4 }, [
      // Rich in Alexandrite, buys no Painite at all.
      quote('Alexandrite', 900_000, 'Boutique', 'Far Away', 40),
      // Slightly worse per tonne, but takes the whole hold.
      quote('Painite', 400_000, 'Big Market', 'Nearby', 8),
      quote('Alexandrite', 700_000, 'Big Market', 'Nearby', 8),
    ]);

    expect(out.bestSale?.station).toBe('Big Market');
    // 200×400,000 + 4×700,000 — what that one landing actually pays.
    expect(out.bestSale?.total).toBe(82_800_000);
  });

  it('MANDATORY: a station cannot be credited for more than it wants', () => {
    /*
     * Demand is finite. Crediting a station for two hundred tonnes when it wants twenty would name
     * a destination that cannot take the load, which is worse than naming a poorer one — the member
     * flies there and then has to fly somewhere else anyway.
     */
    const out = valueHold({ Painite: 200 }, [
      quote('Painite', 900_000, 'Tiny Demand', 'Nearby', 5, 20),
      quote('Painite', 400_000, 'Deep Pockets', 'Nearby', 6, 500),
    ]);

    expect(out.bestSale?.station).toBe('Deep Pockets');
  });

  it('MANDATORY: ties break toward the closer station', () => {
    // Same money, less flying. There is no argument for the far one.
    const out = valueHold({ Painite: 10 }, [
      quote('Painite', 500_000, 'Far', 'Distant', 60),
      quote('Painite', 500_000, 'Near', 'Close', 4),
    ]);

    expect(out.bestSale?.station).toBe('Near');
  });

  it('MANDATORY: an unknown distance never beats a known one on a tie', () => {
    /*
     * A null distance means we could not place the system, not that it is next door. Sorting null
     * as zero would make every unplaceable station win every tie.
     */
    const unplacedFirst = valueHold({ Painite: 10 }, [
      quote('Painite', 500_000, 'Unplaced', 'Nowhere', null),
      quote('Painite', 500_000, 'Known', 'Close', 30),
    ]);
    /*
     * BOTH ORDERS, because the first version of this test only had one — and a mutation that made
     * a null distance WIN every tie survived it, since the null quote happened to be examined
     * first and never reached the comparison. Whichever order the market returns rows in, the
     * placeable station has to win.
     */
    const knownFirst = valueHold({ Painite: 10 }, [
      quote('Painite', 500_000, 'Known', 'Close', 30),
      quote('Painite', 500_000, 'Unplaced', 'Nowhere', null),
    ]);

    expect(unplacedFirst.bestSale?.station).toBe('Known');
    expect(knownFirst.bestSale?.station).toBe('Known');
  });
});
