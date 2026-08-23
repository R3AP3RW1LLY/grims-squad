import { describe, expect, it } from 'vitest';
import { siteDetail, type SiteDetailInput } from './colony-site-detail.js';

/**
 * What a pinned site says about itself.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "Pin a site to see details about it. This will update in real time as you make changes."
 *
 * The facts were all on the plan already and never assembled: choosing between two builds meant
 * reading the catalogue, the simulation, the body and the economy table, and holding the difference
 * in your head.
 */

const input = (over: Partial<SiteDetailInput> = {}): SiteDetailInput => ({
  buildTypeId: 'hermes',
  buildTypeName: 'Coriolis Starport',
  tier: 3,
  totalTonnes: 6_721,
  location: 'orbital',
  effects: {
    population: 1,
    maxPopulation: 2,
    security: 0,
    technology: 0,
    wealth: 3,
    standardOfLiving: 0,
    development: 0,
  },
  needsTier: 3,
  needsPoints: 6,
  bankedTier2: 0,
  bankedTier3: 6,
  economyInfluence: null,
  isPrimary: false,
  ...over,
});

describe('a pinned site', () => {
  it('★ MANDATORY: an unchosen site says so instead of showing zeroes ★', () => {
    /*
     * Most rows in a plan being written look exactly like this. Rendering a cost of 0 and seven
     * zero effects would read as a build that does nothing, rather than as a decision not yet made.
     */
    const d = siteDetail(input({ buildTypeId: null }));

    expect(d.hasBuild).toBe(false);
    expect(d.cost).toBeNull();
    expect(d.notes[0]).toMatch(/no build chosen/i);
  });

  it('reports what a build spends and what is banked for it', () => {
    const d = siteDetail(input({ needsTier: 3, needsPoints: 6, bankedTier3: 6 }));

    expect(d.cost).toEqual({ tier: 3, points: 6, banked: 6 });
    expect(d.affordable).toBe(true);
  });

  it('★ MANDATORY: reads the banked pool that MATCHES the tier it needs ★', () => {
    /*
     * A tier-3 build spends tier-3 points. Reading the tier-2 pool would call a starport affordable
     * because plenty of tier-2 points happen to be banked — the exact arithmetic the picker
     * warnings exist to get right.
     */
    const d = siteDetail(input({ needsTier: 3, needsPoints: 6, bankedTier2: 99, bankedTier3: 1 }));

    expect(d.cost?.banked).toBe(1);
    expect(d.affordable).toBe(false);
  });

  it('★ MANDATORY: the system’s first station is free ★', () => {
    /*
     * The game charges nothing for it. Showing a tier cost would have somebody bank points they
     * never needed and then wonder why the arithmetic never matches the game.
     */
    const d = siteDetail(input({ isPrimary: true, needsPoints: 6, bankedTier3: 0 }));

    expect(d.cost, 'no cost is shown at all').toBeNull();
    expect(d.affordable, 'and it is never unaffordable').toBe(true);
    expect(d.notes.join(' ')).toMatch(/first station/i);
  });

  it('says plainly when the points are not there, and what to do', () => {
    const d = siteDetail(input({ needsTier: 3, needsPoints: 6, bankedTier3: 2 }));

    expect(d.affordable).toBe(false);
    expect(d.notes.join(' ')).toContain('6 tier-3 points');
    expect(d.notes.join(' ')).toContain('only 2 are banked');
    // Not just the problem — the move that fixes it.
    expect(d.notes.join(' ')).toMatch(/build something that gives tier-3/i);
  });

  it('gets the singular right', () => {
    const d = siteDetail(input({ needsTier: 2, needsPoints: 1, bankedTier2: 0 }));

    expect(d.notes.join(' ')).toContain('1 tier-2 point,');
    expect(d.notes.join(' ')).not.toContain('1 tier-2 points');
    // "only 0 are banked" is clumsy exactly where it matters most.
    expect(d.notes.join(' ')).toContain('none are banked');
    expect(d.notes.join(' ')).not.toContain('only 0');
  });

  it('★ MANDATORY: an unaffordable build is reported before anything else ★', () => {
    /*
     * Ordered worst-first, same as the orphan flags: an officer reads the first line. A build that
     * cannot be paid for outranks an observation about what it feeds.
     */
    const d = siteDetail(
      input({ needsTier: 3, needsPoints: 6, bankedTier3: 0, economyInfluence: 'hightech' }),
    );

    expect(d.notes[0]).toMatch(/needs 6 tier-3/i);
  });

  it('flags a build that changes none of the seven measures', () => {
    // Almost always a placeholder somebody meant to come back to.
    const d = siteDetail(
      input({
        effects: {
          population: 0,
          maxPopulation: 0,
          security: 0,
          technology: 0,
          wealth: 0,
          standardOfLiving: 0,
          development: 0,
        },
      }),
    );

    expect(d.notes.join(' ')).toMatch(/changes none of the system/i);
  });

  it('does not flag a build that DOES contribute', () => {
    expect(siteDetail(input()).notes.join(' ')).not.toMatch(/changes none/i);
  });

  it('names what the build feeds, and stays quiet when it feeds nothing', () => {
    expect(siteDetail(input({ economyInfluence: 'refinery' })).notes.join(' ')).toContain('refinery');
    // `none` is the catalogue's way of saying it feeds nothing — printing it would read as an economy.
    expect(siteDetail(input({ economyInfluence: 'none' })).notes.join(' ')).not.toMatch(/feeds/i);
    expect(siteDetail(input({ economyInfluence: null })).notes.join(' ')).not.toMatch(/feeds/i);
  });
});
