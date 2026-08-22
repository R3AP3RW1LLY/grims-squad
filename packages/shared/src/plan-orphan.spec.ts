import { describe, expect, it } from 'vitest';
import { orphanFlags, PLAN_STALE_DAYS, type OrphanPlanFacts } from './plan-orphan.js';

/**
 * Telling a forgotten plan from a broken one.
 *
 * ★ THE OWNER ASKED FOR ALL THREE, RANKED ★
 *
 * Three conditions get called "orphan" and they mean genuinely different things: a plan nobody has
 * touched, a plan nothing is being built to, and a plan measuring progress against projects that no
 * longer exist.
 *
 * The first two want a decision. The third is a fault. A single badge would send an officer to the
 * wrong one, which is why the ranking below is the feature rather than a detail of it.
 */

const NOW = new Date('2026-08-22T00:00:00.000Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

const facts = (over: Partial<OrphanPlanFacts> = {}): OrphanPlanFacts => ({
  planId: 'p1',
  title: 'Pebbletopia',
  systemName: 'Col 285 Sector GL-W c2-12',
  touchedAt: daysAgo(3),
  siteCount: 12,
  danglingSites: 0,
  liveProjects: 2,
  everBuilt: true,
  ...over,
});

describe('a healthy plan', () => {
  it('is flagged for nothing at all', () => {
    expect(orphanFlags(facts(), NOW)).toEqual([]);
  });

  it('★ MANDATORY: an empty plan is never an orphan ★', () => {
    /*
     * A plan with no sites is one somebody started five minutes ago. Judging it would put a warning
     * on the first thing a new member ever does on this platform.
     */
    const brandNew = facts({ siteCount: 0, liveProjects: 0, everBuilt: false, touchedAt: NOW });
    expect(orphanFlags(brandNew, NOW)).toEqual([]);
  });

  it('★ an old plan being built to is an observation, never a warning ★', () => {
    /*
     * ★ THIS TEST ASSERTED THE OPPOSITE, AND WAS WRITTEN UNDER A MODEL THAT DID NOT SURVIVE ★
     *
     * It first said a 400-day-old plan with live projects must not be flagged at all — on the
     * reasoning that staleness is about neglect, and a build somebody hauled to this morning is not
     * neglected.
     *
     * That reasoning is right about DORMANCY and wrong about this. A plan being actively built
     * against a layout nobody has revisited since it was written is worth a quiet line: it is
     * usually where "we built something different from the plan" starts.
     *
     * So it is reported, and reported as the mildest of the three — `stale`, ranked last, phrased as
     * an observation rather than a fault. What it must NOT get is the dormancy sentence, which would
     * tell an officer nothing is being built when three projects are live.
     */
    const old = facts({ touchedAt: daysAgo(400), liveProjects: 3 });
    const flags = orphanFlags(old, NOW);

    expect(flags.map((f) => f.kind)).toEqual(['stale']);
    expect(flags[0]?.message, 'never says nothing is being built').not.toMatch(/finished or abandoned/i);
  });
});

describe('the three conditions, each said in its own words', () => {
  it('★ MANDATORY: a fault outranks an observation ★', () => {
    /*
     * A plan with dangling sites is ALSO old and ALSO has nothing live. Reporting all three would
     * bury the only one that is actually wrong under two that merely describe it — and the officer
     * would read the last line, which is the least useful.
     */
    const broken = facts({ danglingSites: 4, liveProjects: 0, touchedAt: daysAgo(400) });
    const flags = orphanFlags(broken, NOW);

    expect(flags[0]?.kind).toBe('dangling-sites');
    expect(flags.map((f) => f.kind), 'stale is not piled on top of a fault').not.toContain('stale');
  });

  it('names how many sites are broken, because one and forty are different problems', () => {
    const flags = orphanFlags(facts({ danglingSites: 1 }), NOW);
    expect(flags[0]?.message).toContain('1 site');
    expect(flags[0]?.message).not.toContain('1 sites');
  });

  it('★ MANDATORY: never started and given up on read differently ★', () => {
    /*
     * "Nothing has ever been posted here" is a plan waiting for somebody to begin. "Everything here
     * is finished or abandoned" is a plan that has run its course. Both have zero live projects and
     * they call for opposite decisions.
     */
    const neverStarted = orphanFlags(facts({ liveProjects: 0, everBuilt: false }), NOW);
    const finished = orphanFlags(facts({ liveProjects: 0, everBuilt: true }), NOW);

    expect(neverStarted[0]?.message).toMatch(/never been posted|not been started/i);
    expect(finished[0]?.message).toMatch(/finished or abandoned/i);
    expect(neverStarted[0]?.message).not.toBe(finished[0]?.message);
  });

  it(`★ MANDATORY: stale is for a plan that is otherwise FINE ★`, () => {
    /*
     * ★ THE THREE CONDITIONS COLLAPSE TO TWO, AND THE TESTS PROVED IT ★
     *
     * The first version made staleness require that nothing was live — and "nothing is live" is
     * exactly what the flag above fires on, so `stale` could never fire at all. A rule that cannot
     * fire is worse than no rule, because it reads as coverage.
     *
     * Resolved by giving each a distinct meaning. Dormancy (nothing being built) carries the age in
     * its own sentence; staleness is the narrower case of a plan that IS being built to, has no
     * broken rows, and simply has not been revisited since the layout was written.
     */
    const flags = orphanFlags(
      facts({ touchedAt: daysAgo(PLAN_STALE_DAYS + 5), liveProjects: 2 }),
      NOW,
    );
    expect(flags[0]?.kind).toBe('stale');
    expect(flags[0]?.message).toContain(String(PLAN_STALE_DAYS + 5));
  });

  it('a dormant plan carries its age in its own sentence, not as a second flag', () => {
    const flags = orphanFlags(
      facts({ liveProjects: 0, everBuilt: true, touchedAt: daysAgo(200) }),
      NOW,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]?.kind).toBe('nothing-live');
    expect(flags[0]?.message).toContain('200 days');
  });

  it('★ MANDATORY: a quiet month is not neglect ★', () => {
    /*
     * A colonisation plan is a months-long undertaking. A fortnight of quiet means nothing and even
     * a month is ordinary — somebody banking credits or waiting on a carrier. Flagging those would
     * make the whole list shout, and a list that always shouts is one nobody reads.
     */
    expect(orphanFlags(facts({ touchedAt: daysAgo(30) }), NOW)).toEqual([]);
    expect(orphanFlags(facts({ touchedAt: daysAgo(PLAN_STALE_DAYS - 1) }), NOW)).toEqual([]);
  });

  it('never invents a date it was not given', () => {
    // A plan with no timestamp cannot be judged for staleness, and guessing would put a warning on
    // a plan whose only fault is that the column was null.
    expect(orphanFlags(facts({ touchedAt: null }), NOW).map((f) => f.kind)).not.toContain('stale');
  });
});
