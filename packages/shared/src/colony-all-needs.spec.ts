import { describe, expect, it } from 'vitest';
import { mergeNeeds, type ProjectNeed } from './colony-all-needs.js';

/**
 * One shopping list across every build a member is on.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "SrvSurvey will then show cargo items needed only for the primary or all projects."
 *
 * The question a per-project list cannot answer is the one asked standing in a commodity market with
 * an empty hold and three builds running.
 */

const need = (over: Partial<ProjectNeed> = {}): ProjectNeed => ({
  projectId: 'p1',
  title: 'Harry’s Dysfunctional Society',
  commodity: 'Steel',
  remaining: 500,
  ...over,
});

describe('merging what every build still wants', () => {
  it('sums a commodity across builds and keeps the breakdown', () => {
    /*
     * ★ THE BREAKDOWN IS THE POINT ★
     *
     * Two builds wanting 500 t each is 1,000 t to BUY and not 1,000 t to deliver anywhere. A member
     * who cannot see the split fills a hold for one site and finds half of it unwanted on arrival.
     */
    const merged = mergeNeeds([
      need({ projectId: 'p1', title: 'One', remaining: 500 }),
      need({ projectId: 'p2', title: 'Two', remaining: 300 }),
    ]);

    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0]?.tonnes).toBe(800);
    expect(merged.rows[0]?.wantedBy).toEqual([
      { projectId: 'p1', title: 'One', tonnes: 500 },
      { projectId: 'p2', title: 'Two', tonnes: 300 },
    ]);
  });

  it('★ MANDATORY: matches case-insensitively, or one commodity reads as two ★', () => {
    /*
     * The journal, the market dump and the catalogue do not agree on case. Merging on the raw string
     * puts "Steel" and "steel" on separate rows, which doubles the apparent work.
     */
    const merged = mergeNeeds([
      need({ commodity: 'Steel', remaining: 500 }),
      need({ projectId: 'p2', commodity: 'steel', remaining: 300 }),
      need({ projectId: 'p3', commodity: '  STEEL ', remaining: 200 }),
    ]);

    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0]?.tonnes).toBe(1000);
    // Labelled as first seen, not lowercased — the member reads this, not a database.
    expect(merged.rows[0]?.commodity).toBe('Steel');
  });

  it('★ MANDATORY: flags what more than one build wants ★', () => {
    /*
     * The single most useful thing a combined list can say at a market: this is worth buying in
     * bulk and splitting.
     */
    const merged = mergeNeeds([
      need({ commodity: 'Steel' }),
      need({ projectId: 'p2', title: 'Two', commodity: 'Steel' }),
      need({ commodity: 'Titanium' }),
    ]);

    expect(merged.rows.find((r) => r.commodity === 'Steel')?.shared).toBe(true);
    expect(merged.rows.find((r) => r.commodity === 'Titanium')?.shared).toBe(false);
  });

  it('drops finished lines — this list exists to be shopped from', () => {
    const merged = mergeNeeds([
      need({ commodity: 'Steel', remaining: 500 }),
      need({ commodity: 'Titanium', remaining: 0 }),
      need({ commodity: 'Copper', remaining: -40 }),
    ]);

    expect(merged.rows.map((r) => r.commodity)).toEqual(['Steel']);
  });

  it('★ MANDATORY: the first source that KNOWS the category wins ★', () => {
    /*
     * A depot read off the pad carries no market data at all. If the first row seen simply won, one
     * build filled that way would pin the row to "no category" for every other build that does know
     * it — and the overlay groups by category, so the row would file under a heading that is false.
     */
    const merged = mergeNeeds([
      need({ commodity: 'Steel', category: null }),
      need({ projectId: 'p2', commodity: 'Steel', category: 'Metals' }),
    ]);

    expect(merged.rows[0]?.category).toBe('Metals');
  });

  it('counts the builds that actually contributed, not the rows', () => {
    const merged = mergeNeeds([
      need({ projectId: 'p1', commodity: 'Steel' }),
      need({ projectId: 'p1', commodity: 'Titanium' }),
      need({ projectId: 'p2', commodity: 'Steel' }),
      // Finished, so this build contributes nothing and must not be counted as running.
      need({ projectId: 'p3', commodity: 'Copper', remaining: 0 }),
    ]);

    expect(merged.projects).toBe(2);
  });

  it('sums a build that reports one commodity on several rows', () => {
    const merged = mergeNeeds([
      need({ commodity: 'Steel', remaining: 200 }),
      need({ commodity: 'Steel', remaining: 300 }),
    ]);

    expect(merged.rows[0]?.wantedBy).toEqual([
      { projectId: 'p1', title: 'Harry’s Dysfunctional Society', tonnes: 500 },
    ]);
  });

  it('★ MANDATORY: orders stably, so a poll does not make the strip flicker ★', () => {
    /*
     * Biggest first fills a hold. Ties break on name — two equal rows swapping places between
     * identical polls reads as flicker on a panel over a cockpit.
     */
    const merged = mergeNeeds([
      need({ commodity: 'Titanium', remaining: 100 }),
      need({ commodity: 'Aluminium', remaining: 100 }),
      need({ commodity: 'Steel', remaining: 900 }),
    ]);

    expect(merged.rows.map((r) => r.commodity)).toEqual(['Steel', 'Aluminium', 'Titanium']);
  });

  it('an empty list is an answer, not a gap', () => {
    const merged = mergeNeeds([]);

    expect(merged.rows).toEqual([]);
    expect(merged.projects).toBe(0);
    expect(merged.totalTonnes).toBe(0);
  });

  it('ignores a blank commodity rather than making a nameless row', () => {
    expect(mergeNeeds([need({ commodity: '   ' })]).rows).toEqual([]);
  });

  it('totals what there is to buy', () => {
    const merged = mergeNeeds([
      need({ commodity: 'Steel', remaining: 500 }),
      need({ projectId: 'p2', commodity: 'Titanium', remaining: 250 }),
    ]);

    expect(merged.totalTonnes).toBe(750);
  });
});
