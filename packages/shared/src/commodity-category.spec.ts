import { describe, expect, it } from 'vitest';
import { groupByCategory, MARKET_CATEGORIES, UNSOLD_CATEGORY } from './commodity-category.js';

/**
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "break down all materials into their respective market categories ... so that its easier to search
 * for these commodities"
 *
 * Five surfaces render this — two on the website, two in the companion, one in the in-game overlay.
 * The grouping is a pure function precisely so all five can be proven once here rather than eyeballed
 * five times, and so they cannot drift apart later.
 */

const row = (commodity: string, category: string | null, remaining: number) => ({
  commodity,
  category,
  remaining,
});

describe('grouping a build by market category', () => {
  it('★ MANDATORY: the heaviest outstanding category comes first ★', () => {
    /*
     * Alphabetically Metals is eighth of fifteen — below the fold on the overlay. On a real build it
     * is also where three quarters of the tonnage lives, which is what somebody opening the list is
     * trying to find.
     */
    const groups = groupByCategory([
      row('Robotics', 'Technology', 520),
      row('Steel', 'Metals', 1898),
      row('CMM Composite', 'Industrial Materials', 712),
      row('Aluminium', 'Metals', 366),
    ]);

    expect(groups.map((g) => g.category)).toEqual([
      'Metals',
      'Industrial Materials',
      'Technology',
    ]);
    expect(groups[0]?.outstanding, 'Steel + Aluminium').toBe(2264);
  });

  it('MANDATORY: within a group, the biggest shortfall is first', () => {
    // The same rule the flat lists used. Grouping changes where a row sits, never why.
    const [metals] = groupByCategory([
      row('Aluminium', 'Metals', 366),
      row('Steel', 'Metals', 1898),
      row('Copper', 'Metals', 900),
    ]);
    expect(metals?.rows.map((r) => r.commodity)).toEqual(['Steel', 'Copper', 'Aluminium']);
  });

  it('★ MANDATORY: a commodity nothing sells is named, not hidden ★', () => {
    /*
     * `Agricultural Medicines` and `Hazardous Environment Suits` appear in ZERO rows across the whole
     * market mirror. Not rare — absent. Filing them under a real category would send somebody
     * hunting a board that has never carried them.
     */
    const groups = groupByCategory([
      row('Steel', 'Metals', 100),
      row('Hazardous Environment Suits', null, 124),
    ]);

    const unsold = groups.find((g) => g.category === UNSOLD_CATEGORY);
    expect(unsold?.rows.map((r) => r.commodity)).toEqual(['Hazardous Environment Suits']);
  });

  it('MANDATORY: an unrecognised category is not allowed to invent a heading', () => {
    /*
     * A typo or a new category from upstream would otherwise appear as its own one-row section that
     * looks deliberate. It goes to the same honest bucket as the unsold ones until somebody adds it
     * to MARKET_CATEGORIES on purpose.
     */
    const groups = groupByCategory([row('Something New', 'Nanotechnology', 50)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe(UNSOLD_CATEGORY);
  });

  it('MANDATORY: finished categories sink below outstanding ones', () => {
    /*
     * Delivered rows were restored to these lists yesterday, so a fully-delivered category is a real
     * thing that must still appear — as the record of work done, underneath the work remaining.
     */
    const groups = groupByCategory([
      row('Steel', 'Metals', 0),
      row('Titanium', 'Metals', 0),
      row('Robotics', 'Technology', 10),
    ]);

    expect(groups.map((g) => g.category)).toEqual(['Technology', 'Metals']);
    expect(groups[1]?.complete).toBe(true);
    expect(groups[0]?.complete).toBe(false);
  });

  it('finished groups keep a stable order rather than reshuffling on refresh', () => {
    // Two groups with nothing outstanding tie on tonnage; alphabetical breaks it the same way every
    // time, so a completed section does not move around under somebody reading it.
    const groups = groupByCategory([
      row('Wine', 'Legal Drugs', 0),
      row('Steel', 'Metals', 0),
      row('Beer', 'Chemicals', 0),
    ]);
    expect(groups.map((g) => g.category)).toEqual(['Chemicals', 'Legal Drugs', 'Metals']);
  });

  it('never loses a row', () => {
    // The one property that matters more than any ordering: grouping is a rearrangement.
    const rows = [
      row('Steel', 'Metals', 100),
      row('Robotics', 'Technology', 50),
      row('Mystery', null, 25),
      row('Water', 'Chemicals', 0),
    ];
    const total = groupByCategory(rows).reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(rows.length);
  });

  it('handles an empty build without inventing a group', () => {
    expect(groupByCategory([])).toEqual([]);
  });

  it('the category list matches what the mirror actually holds', () => {
    // Counted from commodity_snapshots on 2026-08-10. If upstream adds one, this is where somebody
    // notices — rather than in a member's screenshot of a heading nobody meant to ship.
    expect(MARKET_CATEGORIES).toHaveLength(15);
    for (const expected of ['Metals', 'Technology', 'Industrial Materials', 'Chemicals']) {
      expect(MARKET_CATEGORIES).toContain(expected);
    }
  });
});
