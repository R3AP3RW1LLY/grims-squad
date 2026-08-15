import { describe, expect, it } from 'vitest';
import {
  COLONY_STATUS_FILTERS,
  DEFAULT_COLONY_FILTER,
  colonyStatusOf,
  maySeeAbandoned,
  matchesColonyFilter,
  type ColonyStatusRow,
} from './colony-status.js';
import { Permission } from './permissions.js';

/**
 * In progress, complete, or abandoned.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "we also need to allow admins to mark builds as abandoned and not always just as complete.
 * abandond projects should be hidden to all other members except the project owner please. and
 * should appear red."
 *
 * ★ WHY A THIRD STATE RATHER THAN JUST CLOSING IT ★
 *
 * Today a project is complete or it is not — `completedAt` and nothing else. So a build the
 * squadron gave up on has two possible endings, and both are lies: leave it open and it sits on the
 * board for ever asking for materials nobody will haul, or mark it complete and it enters the
 * record as a station that was finished, inflating the totals the squadron measures itself by.
 *
 * The second one is worse, and it is the one people actually do — because closing the thing is the
 * only button there is.
 */

const row = (over: Partial<ColonyStatusRow> = {}): ColonyStatusRow => ({
  completedAt: over.completedAt === undefined ? null : over.completedAt,
  abandonedAt: over.abandonedAt === undefined ? null : over.abandonedAt,
});

const AT = new Date('2026-08-15T12:00:00Z');

describe('what state a project is in', () => {
  it('★ MANDATORY: abandoned outranks complete ★', () => {
    /*
     * They can both be set: a project marked complete, and later marked abandoned by an officer who
     * knows it never was. Reading `completedAt` first would show the wrong one — and it would show
     * the very state the officer acted to correct.
     */
    expect(colonyStatusOf(row({ completedAt: AT, abandonedAt: AT }))).toBe('abandoned');
  });

  it('a finished build is complete', () => {
    expect(colonyStatusOf(row({ completedAt: AT }))).toBe('complete');
  });

  it('an open build is in progress', () => {
    expect(colonyStatusOf(row())).toBe('in-progress');
  });
});

describe('who may see an abandoned build', () => {
  it('★ MANDATORY: the member who posted it always can ★', () => {
    // It is their build. Hiding somebody's own project from them would look exactly like the
    // platform having deleted it.
    expect(maySeeAbandoned({ viewerId: 'me', postedById: 'me', mask: 0n })).toBe(true);
  });

  it('★ MANDATORY: an officer can ★', () => {
    /*
     * The owner chose this: officers see abandoned builds of both kinds. Somebody has to be able to
     * review the decision, and a state only its own author can see is a state nobody can audit —
     * including the officer who set it.
     */
    expect(
      maySeeAbandoned({ viewerId: 'officer', postedById: 'someone', mask: Permission.COLONY_MANAGE }),
    ).toBe(true);
  });

  it('★ MANDATORY: any other member cannot ★', () => {
    /*
     * The whole point. An abandoned project left visible is a project members keep buying materials
     * for — which is the same complaint that produced the completion safeguard: "causes our members
     * to go buy materials for a project thats completed".
     */
    expect(maySeeAbandoned({ viewerId: 'other', postedById: 'someone', mask: 0n })).toBe(false);
  });

  it('★ MANDATORY: a signed-out reader cannot, even on a public project ★', () => {
    // `public` is a member choosing to share a build they are working on. Abandoning it is not a
    // decision to publish the fact more widely.
    expect(maySeeAbandoned({ viewerId: null, postedById: 'someone', mask: 0n })).toBe(false);
  });

  it('MANDATORY: an unrelated permission does not do it', () => {
    // Guards against a mask test written as "any permission at all", which would let every member
    // with any role see them.
    expect(
      maySeeAbandoned({ viewerId: 'other', postedById: 'someone', mask: Permission.FORUM_POST_MEMBER }),
    ).toBe(false);
  });
});

describe('the view filters', () => {
  it('★ MANDATORY: in progress is the default ★', () => {
    /*
     * The owner asked for the filters because the board fills with finished builds. Defaulting to
     * "all" would leave the page exactly as it is today and the filter would be something everybody
     * has to set on every visit.
     */
    expect(DEFAULT_COLONY_FILTER).toBe('in-progress');
  });

  it('in progress excludes complete and abandoned', () => {
    expect(matchesColonyFilter(row(), 'in-progress')).toBe(true);
    expect(matchesColonyFilter(row({ completedAt: AT }), 'in-progress')).toBe(false);
    expect(matchesColonyFilter(row({ abandonedAt: AT }), 'in-progress')).toBe(false);
  });

  it('complete shows only finished builds', () => {
    expect(matchesColonyFilter(row({ completedAt: AT }), 'complete')).toBe(true);
    expect(matchesColonyFilter(row(), 'complete')).toBe(false);
  });

  it('★ MANDATORY: a project marked complete AND abandoned is not in the complete list ★', () => {
    // It follows from `colonyStatusOf`, and it is asserted separately because the filter is what a
    // member actually reads. An abandoned build appearing under "complete" is the inflated record
    // the third state exists to prevent.
    expect(matchesColonyFilter(row({ completedAt: AT, abandonedAt: AT }), 'complete')).toBe(false);
    expect(matchesColonyFilter(row({ completedAt: AT, abandonedAt: AT }), 'abandoned')).toBe(true);
  });

  it('MANDATORY: every filter is a real status, and every status is filterable', () => {
    /*
     * The join between the two lists. A status with no filter is a build nobody can find; a filter
     * matching no status is a tab that is always empty.
     */
    expect([...COLONY_STATUS_FILTERS].sort()).toEqual(
      ['abandoned', 'all', 'complete', 'in-progress'].sort(),
    );
  });

  it('all shows everything, including abandoned', () => {
    // Subject to `maySeeAbandoned` — the filter says what a reader ASKED for, never what they may
    // see. Two different questions, and merging them is how one of them gets forgotten.
    for (const r of [row(), row({ completedAt: AT }), row({ abandonedAt: AT })]) {
      expect(matchesColonyFilter(r, 'all')).toBe(true);
    }
  });
});
