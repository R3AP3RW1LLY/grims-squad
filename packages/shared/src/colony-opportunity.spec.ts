import { describe, expect, it } from 'vitest';
import {
  NEARLY_DONE,
  STALE_DAYS,
  rankOpportunities,
  type Opportunity,
  type OpportunityInput,
} from './colony-opportunity.js';

/**
 * "What can I do tonight?"
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * Picked from the colonisation suggestions: match a member against every open project, sort the
 * boards by what actually matters, and say when a build has stalled.
 *
 * ★ THE PROBLEM IT SOLVES ★
 *
 * The boards list projects in the order they were posted. A member with an evening free reads
 * nineteen rows and has no way to tell which one wants them — the one 8 ly away that needs 400 t is
 * indistinguishable from the one 900 ly away that needs a quarter of a million.
 *
 * ★ WHY IT SCORES AND ALSO EXPLAINS ★
 *
 * A single opaque number that reorders somebody's evening is not trustworthy. Every point this
 * awards comes with the sentence that earned it, so a member can disagree with the ranking rather
 * than having to accept or ignore it.
 */

const NOW = Date.parse('2026-08-10T20:00:00Z');
const DAY = 86_400_000;

/** A project with everything neutral, so each test varies exactly one thing. */
function project(over: Partial<OpportunityInput> = {}): OpportunityInput {
  return {
    id: over.id ?? 'p',
    title: over.title ?? 'A build',
    systemName: over.systemName ?? 'Somewhere',
    owner: over.owner ?? 'squadron',
    isPriority: over.isPriority ?? false,
    remaining: over.remaining ?? 50_000,
    required: over.required ?? 100_000,
    coords: over.coords === undefined ? { x: 0, y: 0, z: 0 } : over.coords,
    lastDeliveryAt: over.lastDeliveryAt === undefined ? new Date(NOW - DAY) : over.lastDeliveryAt,
  };
}

const HERE = { x: 0, y: 0, z: 0 };
const ids = (out: readonly Opportunity[]): string[] => out.map((o) => o.id);

describe('ranking what a member could do tonight', () => {
  it('★ MANDATORY: a finished build is never offered ★', () => {
    /*
     * `remaining: 0` is a build somebody has already finished hauling to. Offering it wastes the
     * one thing this exists to save — the evening of the person reading it.
     */
    const out = rankOpportunities(
      [project({ id: 'done', remaining: 0 }), project({ id: 'open' })],
      { coords: HERE, now: NOW },
    );
    expect(ids(out)).toEqual(['open']);
  });

  it('★ MANDATORY: nearer wins, all else equal ★', () => {
    const out = rankOpportunities(
      [
        project({ id: 'far', coords: { x: 400, y: 0, z: 0 } }),
        project({ id: 'near', coords: { x: 8, y: 0, z: 0 } }),
      ],
      { coords: HERE, now: NOW },
    );
    expect(ids(out)[0]).toBe('near');
    expect(out[0]?.distanceLy).toBe(8);
  });

  it('★ MANDATORY: a priority build outranks a merely closer one ★', () => {
    /*
     * The squadron flagged it. That is an officer's decision about what matters, and a ranking that
     * quietly overrode it with geometry would be answering a different question than the one asked.
     */
    const out = rankOpportunities(
      [
        project({ id: 'close', coords: { x: 5, y: 0, z: 0 } }),
        project({ id: 'urgent', isPriority: true, coords: { x: 60, y: 0, z: 0 } }),
      ],
      { coords: HERE, now: NOW },
    );
    expect(ids(out)[0]).toBe('urgent');
  });

  it('★ MANDATORY: every score is explained, never bare ★', () => {
    const [top] = rankOpportunities(
      [project({ id: 'p', isPriority: true, remaining: 400, coords: { x: 10, y: 0, z: 0 } })],
      { coords: HERE, now: NOW },
    );

    expect(top?.reasons.length, 'a number that reorders an evening with no reason given').
      toBeGreaterThan(0);
    expect(top?.reasons.join(' ')).toMatch(/priority/i);
    // Each reason is a sentence a person can disagree with, not a field name.
    for (const r of top?.reasons ?? []) expect(r).toMatch(/[a-z]/);
  });

  it('★ MANDATORY: a stalled build is surfaced, because nobody else will notice ★', () => {
    /*
     * A build nobody has hauled to in over a week is the one case the boards cannot show by
     * themselves — it looks identical to a healthy one, just with an older number.
     */
    const out = rankOpportunities(
      [
        project({ id: 'moving', lastDeliveryAt: new Date(NOW - DAY) }),
        project({ id: 'stalled', lastDeliveryAt: new Date(NOW - 9 * DAY) }),
      ],
      { coords: HERE, now: NOW },
    );

    const stalled = out.find((o) => o.id === 'stalled');
    expect(stalled?.stalled).toBe(true);
    expect(stalled?.daysSinceDelivery).toBe(9);
    expect(out.find((o) => o.id === 'moving')?.stalled).toBe(false);
    expect(stalled?.reasons.join(' ')).toMatch(/9 days/);
  });

  it('★ MANDATORY: a build nobody has ever hauled to is NOT called stalled ★', () => {
    /*
     * Different thing entirely, and the wording matters: "nothing delivered in 9 days" about a
     * project posted an hour ago reads as a broken tracker.
     */
    const [only] = rankOpportunities([project({ id: 'new', lastDeliveryAt: null })], {
      coords: HERE,
      now: NOW,
    });
    expect(only?.stalled).toBe(false);
    expect(only?.daysSinceDelivery).toBeNull();
    expect(only?.reasons.join(' ')).not.toMatch(/stalled|nothing delivered/i);
  });

  it('MANDATORY: a nearly-finished build is pushed up, because finishing beats starting', () => {
    const out = rankOpportunities(
      [
        project({ id: 'barely', remaining: 99_000, required: 100_000 }),
        project({ id: 'nearly', remaining: 2_000, required: 100_000 }),
      ],
      { coords: HERE, now: NOW },
    );
    expect(ids(out)[0]).toBe('nearly');
    expect(out[0]?.pctDone).toBe(98);
    expect(out[0]?.reasons.join(' ')).toMatch(/98%/);
  });

  it(`MANDATORY: NEARLY_DONE is a share, not a tonnage`, () => {
    // 2,000 t left of 100,000 is nearly done; 2,000 t left of 2,500 is not.
    const out = rankOpportunities(
      [
        project({ id: 'big', remaining: 2_000, required: 100_000 }),
        project({ id: 'small', remaining: 2_000, required: 2_500 }),
      ],
      { coords: HERE, now: NOW },
    );
    expect(out.find((o) => o.id === 'big')?.pctDone).toBeGreaterThanOrEqual(NEARLY_DONE * 100);
    expect(out.find((o) => o.id === 'small')?.pctDone).toBeLessThan(NEARLY_DONE * 100);
  });

  it('MANDATORY: with no position, it still ranks — on everything except distance', () => {
    /*
     * A member who has never run the app, or whose last sighting we lost, must not get an empty
     * page. Distance simply stops contributing rather than the whole feature failing.
     */
    const out = rankOpportunities(
      [
        project({ id: 'far-urgent', isPriority: true, coords: { x: 900, y: 0, z: 0 } }),
        project({ id: 'near-idle', coords: { x: 2, y: 0, z: 0 } }),
      ],
      { coords: null, now: NOW },
    );

    expect(ids(out)[0]).toBe('far-urgent');
    expect(out[0]?.distanceLy, 'a distance from nowhere is not zero, it is unknown').toBeNull();
  });

  it('MANDATORY: a project we cannot place is ranked, not dropped', () => {
    // Systems our galaxy table has never heard of still have people hauling to them.
    const out = rankOpportunities(
      [project({ id: 'unplaceable', coords: null, isPriority: true })],
      { coords: HERE, now: NOW },
    );
    expect(ids(out)).toEqual(['unplaceable']);
    expect(out[0]?.distanceLy).toBeNull();
  });

  it('MANDATORY: distance is real 3D, not a single axis', () => {
    const out = rankOpportunities([project({ id: 'p', coords: { x: 3, y: 4, z: 0 } })], {
      coords: HERE,
      now: NOW,
    });
    expect(out[0]?.distanceLy).toBe(5);
  });

  it('MANDATORY: the order is stable for two identical projects', () => {
    // Two builds that score the same must not swap places between page loads.
    const a = rankOpportunities([project({ id: 'a' }), project({ id: 'b' })], {
      coords: HERE,
      now: NOW,
    });
    const b = rankOpportunities([project({ id: 'a' }), project({ id: 'b' })], {
      coords: HERE,
      now: NOW,
    });
    expect(ids(a)).toEqual(ids(b));
  });

  it('answers empty for a squadron with nothing open', () => {
    expect(rankOpportunities([], { coords: HERE, now: NOW })).toEqual([]);
  });

  it('STALE_DAYS is the documented week, not an arbitrary number', () => {
    expect(STALE_DAYS).toBe(7);
  });
});
