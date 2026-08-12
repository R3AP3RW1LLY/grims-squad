import { describe, expect, it } from 'vitest';
import { commodityKey } from './commodity-name.js';

/**
 * One commodity, two names, and the build it stopped us identifying.
 *
 * ★ FOUND IN PRODUCTION — SQUADRON OWNER, 2026-08-12 ★
 *
 * "on my build plan in production i have these 2 lines ... ONE IS COMPLETED AND ONE IS BEING BUILT
 * BUT THEY SHOW NOTHING"
 *
 * Two Refinery Hubs on B 8 b: Gunn Point (complete) and Rees Prospect (building). Both showed as
 * merely planned, because neither project had ever been IDENTIFIED, and nothing unidentified can be
 * linked to the plan that intended it.
 *
 * The fingerprint compares a project's twenty required commodities against the catalogue's. Every
 * line matched except one:
 *
 *   the game's journal says   H.E. Suits                    117 t
 *   our catalogue says        Hazardous Environment Suits   117 t
 *
 * Same commodity, same tonnage, different name. `matchBuildType` is exact on every line — rightly,
 * since two settlement types can differ by a single commodity and a fuzzy match would confidently
 * mislabel a build — so one alias failed the whole identification, silently, and took three
 * projects with it.
 *
 * ★ WHY A KEY RATHER THAN A RENAME ★
 *
 * Both names are correct. The journal's is what the game emits and the catalogue's is what a member
 * reads on a shopping list, and rewriting either would break the surface that depends on it. So
 * nothing is renamed: they are compared through a key that treats them as the same thing.
 */

describe('comparing two names for one commodity', () => {
  it('★ MANDATORY: the alias that broke identification in production ★', () => {
    expect(commodityKey('H.E. Suits')).toBe(commodityKey('Hazardous Environment Suits'));
  });

  it('★ MANDATORY: the other known journal alias ★', () => {
    /*
     * The same class, not yet seen in a project only because nobody has posted an agriculture
     * build. commodity-category.ts already records these two together as the pair that appear in
     * ZERO market rows galaxy-wide — they are the two the game abbreviates.
     */
    expect(commodityKey('Agri-Medicines')).toBe(commodityKey('Agricultural Medicines'));
  });

  it('★ MANDATORY: different commodities stay different ★', () => {
    // The whole value of an exact fingerprint is that it does not blur two builds together.
    expect(commodityKey('Steel')).not.toBe(commodityKey('Aluminium'));
    expect(commodityKey('Water')).not.toBe(commodityKey('Water Purifiers'));
    expect(commodityKey('Ceramic Composites')).not.toBe(commodityKey('Ceramic Insulation'));
  });

  it('MANDATORY: case and surrounding space do not matter', () => {
    // Two sources spell them differently; the journal has been seen to pad names.
    expect(commodityKey('  steel ')).toBe(commodityKey('Steel'));
  });

  it('MANDATORY: an unknown name is left alone rather than guessed at', () => {
    // A commodity we have never seen must still compare equal to itself, and to nothing else.
    expect(commodityKey('Some New Commodity')).toBe(commodityKey('some new commodity'));
    expect(commodityKey('Some New Commodity')).not.toBe(commodityKey('Steel'));
  });
});
