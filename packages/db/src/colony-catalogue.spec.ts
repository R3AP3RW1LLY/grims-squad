import { describe, expect, it } from 'vitest';
import { matchBuildType, type BuildTypeSeed } from './colony-catalogue.js';

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
