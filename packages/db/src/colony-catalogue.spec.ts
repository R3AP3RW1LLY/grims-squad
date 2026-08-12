import { describe, expect, it } from 'vitest';
import { matchBuildType, type BuildTypeSeed, sameBill } from './colony-catalogue.js';

/**
 * Identifying a construction site from what it asks for.
 *
 * ★ WHY THIS IS A FINGERPRINT AND NOT A GUESS ★
 *
 * The journal never says what is being built. `ColonisationConstructionDepot` reports what a site
 * still wants and nothing about its kind, and the station name is whatever the architect typed.
 *
 * A build type's requirement is a vector of twenty-odd commodities at exact tonnages, and no two
 * share one. So the requirement identifies the build — which is how a project learns what it is
 * with nobody choosing from a dropdown.
 *
 * ★ THE REAL BUG THIS CAUGHT ★
 *
 * The catalogue was seeded from community figures and then compared against the squadron's own
 * construction site. It missed by exactly one commodity out of twenty-three: same tonnage, wrong
 * name — Frontier's internal symbol says `terrainenrichmentsystems`, the commodity on a market
 * screen says LAND Enrichment Systems, and the seed had believed the symbol. Reality won, which is
 * the entire argument for keeping our own readings as the authority.
 */

function type(id: string, costs: Record<string, number>): BuildTypeSeed {
  return {
    id,
    displayName: id,
    category: 'test',
    tier: 1,
    location: 'orbital',
    padSize: 'large',
    layouts: [],
    totalTonnes: Object.values(costs).reduce((a, b) => a + b, 0),
    costs: Object.entries(costs).map(([commodity, tonnes]) => ({ commodity, tonnes })),

    /*
     * The simulation fields, at their neutral values. These tests are about IDENTIFYING a build
     * from its bill of materials, which the construction-point rules have nothing to do with — so
     * they are filled in rather than varied, and a fixture that varied them would suggest the
     * fingerprint depended on them.
     */
    buildClass: 'outpost',
    needsTier: 0,
    needsPoints: 0,
    givesTier: 0,
    givesPoints: 0,
    requires: null,
    satisfies: [],
    economyInfluence: 'none',
    economyFixed: null,
    effects: {
      population: 0,
      maxPopulation: 0,
      security: 0,
      technology: 0,
      wealth: 0,
      standardOfLiving: 0,
      development: 0,
    },
  };
}

const OUTPOST = type('outpost', { Steel: 1000, Titanium: 500, Aluminium: 250 });
const DEPOT = type('depot', { Steel: 1000, Titanium: 500, Polymers: 250 });
const CATALOGUE = [OUTPOST, DEPOT];

describe('identifying a build from what it wants', () => {
  it('matches an exact requirement', () => {
    const want = new Map([
      ['Steel', 1000],
      ['Titanium', 500],
      ['Aluminium', 250],
    ]);
    expect(matchBuildType(want, CATALOGUE)?.id).toBe('outpost');
  });

  it('tells apart two builds that differ by ONE commodity', () => {
    /*
     * The case that makes fuzzy matching unacceptable. Outpost and Depot share two of three
     * commodities at identical tonnages — a "close enough" match would pick whichever came first
     * and confidently mislabel the site, which then pre-fills the wrong shopping list and costs
     * somebody a wasted trip.
     */
    const want = new Map([
      ['Steel', 1000],
      ['Titanium', 500],
      ['Polymers', 250],
    ]);
    expect(matchBuildType(want, CATALOGUE)?.id).toBe('depot');
  });

  it('refuses a requirement that is one tonne out', () => {
    const want = new Map([
      ['Steel', 1001],
      ['Titanium', 500],
      ['Aluminium', 250],
    ]);
    // No match is a useful answer: it means a build type we have not recorded, which is information.
    expect(matchBuildType(want, CATALOGUE)).toBeNull();
  });

  it('refuses a requirement with an extra commodity', () => {
    const want = new Map([
      ['Steel', 1000],
      ['Titanium', 500],
      ['Aluminium', 250],
      ['Water', 10],
    ]);
    expect(matchBuildType(want, CATALOGUE)).toBeNull();
  });

  it('refuses a requirement missing one', () => {
    const want = new Map([
      ['Steel', 1000],
      ['Titanium', 500],
    ]);
    expect(matchBuildType(want, CATALOGUE)).toBeNull();
  });

  it('refuses a commodity whose NAME is wrong even at the right tonnage', () => {
    /*
     * This is the bug that actually happened, in miniature. Every tonnage correct, one name from
     * Frontier's internal symbols rather than from a market screen — and the match silently failed
     * rather than being silently wrong, which is the behaviour worth having.
     */
    const want = new Map([
      ['Steel', 1000],
      ['Titanium', 500],
      ['Terrain Enrichment Systems', 250],
    ]);
    expect(matchBuildType(want, CATALOGUE)).toBeNull();
  });

  it('says nothing about a site nobody has docked at', () => {
    expect(matchBuildType(new Map(), CATALOGUE)).toBeNull();
  });
});

describe('one bill, two spellings', () => {
  /**
   * ★ THE COMPARISON THAT LIVED IN TWO PLACES — 2026-08-12 ★
   *
   * `matchBuildType` and `identifyBuildTypes` each carried their own copy. Adding `commodityKey` to
   * one side of one of them left the other comparing a lowercased key against a raw name, so every
   * commodity mismatched and NOTHING could identify. Ninety-seven tests here passed, because they
   * covered the exported function and not the inline copy, and it failed on the first real database.
   *
   * `sameBill` is now the single definition and owns both the keying and the equality. These are the
   * tests that would have caught it.
   */
  const bill = (o: Record<string, number>): Map<string, number> => new Map(Object.entries(o));

  it('★ MANDATORY: the journal spelling equals the catalogue spelling ★', () => {
    // The exact pair that hid two finished Refinery Hubs: the game says one, our catalogue the other.
    const required = bill({ Steel: 3720, 'H.E. Suits': 117 });
    const costs = bill({ Steel: 3720, 'Hazardous Environment Suits': 117 });

    expect(sameBill(required, costs)).toBe(true);
  });

  it('★ MANDATORY: it does not require the caller to have keyed anything ★', () => {
    /*
     * The regression itself. A caller passing plain, differently-cased names must still match —
     * pre-keying was a hidden precondition, and a comparison with a hidden precondition is a trap.
     */
    expect(sameBill(bill({ steel: 3720 }), bill({ Steel: 3720 }))).toBe(true);
  });

  it('★ MANDATORY: one tonne out is not the same bill ★', () => {
    // The exactness this rests on: two settlement types can differ by a single commodity.
    expect(sameBill(bill({ Steel: 3720 }), bill({ Steel: 3719 }))).toBe(false);
  });

  it('MANDATORY: a missing or extra line is not the same bill', () => {
    expect(sameBill(bill({ Steel: 3720 }), bill({ Steel: 3720, Polymers: 744 }))).toBe(false);
    expect(sameBill(bill({ Steel: 3720, Polymers: 744 }), bill({ Steel: 3720 }))).toBe(false);
  });
});
