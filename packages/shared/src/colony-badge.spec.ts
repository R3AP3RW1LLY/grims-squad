import { describe, expect, it } from 'vitest';
import { openProjectCounts } from './colony-badge.js';

/**
 * How many colonisation projects still want hauling.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "when a colonization project is complete, we need to remove it from the badge that appears in
 * the navmenu on the companion app, we also need to add this notification/badge to the web site
 * too showing completed projects is confusing!"
 *
 * ★ WHY THIS LIVES IN SHARED ★
 *
 * The same number now appears in two places. Counted separately they would drift, and the half that
 * drifted would be whichever surface nobody re-reads — leaving a member looking at "4" in the app
 * and "6" on the site with no way to tell which was lying.
 */

const project = (owner: 'squadron' | 'personal', completedAt: string | null) => ({
  owner,
  completedAt,
});

describe('counting projects that still need hauling', () => {
  it('MANDATORY: a completed project is not counted', () => {
    /*
     * The whole bug. A finished build kept advertising itself in the nav for ever, so the badge
     * said there was work to do that had already been done.
     */
    const counts = openProjectCounts([
      project('squadron', null),
      project('squadron', '2026-08-01T12:00:00Z'),
    ]);

    expect(counts.squadron, 'a finished build was still being advertised').toBe(1);
  });

  it('MANDATORY: squadron and personal are counted apart', () => {
    const counts = openProjectCounts([
      project('squadron', null),
      project('squadron', null),
      project('personal', null),
    ]);

    expect(counts.squadron).toBe(2);
    expect(counts.personal).toBe(1);
  });

  it('MANDATORY: everything finished counts zero, not the total', () => {
    const counts = openProjectCounts([
      project('squadron', '2026-07-01T00:00:00Z'),
      project('personal', '2026-07-02T00:00:00Z'),
    ]);

    expect(counts.squadron).toBe(0);
    expect(counts.personal).toBe(0);
  });

  it('MANDATORY: nothing at all is zero, not a crash', () => {
    expect(openProjectCounts([])).toEqual({ squadron: 0, personal: 0 });
  });

  it('MANDATORY: an empty completion string does not count as finished', () => {
    /*
     * `completedAt` arrives as JSON off two different doors. An empty string is not a date, and
     * treating it as one would silently hide a live build from the people meant to be hauling for
     * it — the opposite failure, and a worse one.
     */
    expect(openProjectCounts([project('squadron', '')]).squadron).toBe(1);
  });
});

describe('a build the squadron gave up on', () => {
  it('★ MANDATORY: an abandoned project is not counted as wanting hauling ★', () => {
    /*
     * ★ THE BADGE PROMISED WORK THAT DID NOT EXIST ★
     *
     * This count is the sidebar number on BOTH the website and the companion app — one function,
     * so one bug in two places. `finished` tested only `completedAt`, which meant a build an
     * officer had given up on went on advertising itself as needing haulers indefinitely.
     *
     * It is the complaint that produced the completion safeguard, arriving through another door:
     * "causes our members to go buy materials for a project thats completed".
     */
    const counts = openProjectCounts([
      { owner: 'squadron', completedAt: null, abandonedAt: '2026-08-15T12:00:00Z' },
      { owner: 'squadron', completedAt: null },
      { owner: 'personal', completedAt: null, abandonedAt: '2026-08-15T12:00:00Z' },
    ]);

    expect(counts.squadron, 'only the live one').toBe(1);
    expect(counts.personal).toBe(0);
  });

  it('MANDATORY: a row with no abandonedAt at all still counts, as it always did', () => {
    /*
     * The field is optional because an older companion build sends payloads that predate the
     * column. Treating "absent" as "abandoned" would make every project vanish from the badge the
     * moment somebody ran a version that had not been updated.
     */
    expect(openProjectCounts([{ owner: 'squadron', completedAt: null }]).squadron).toBe(1);
  });

  it('MANDATORY: an empty string is not a date here either', () => {
    // The same reasoning `completedAt` already carries: a blank is not a stamp, and treating it as
    // one hides a live build from the people meant to be hauling for it.
    expect(
      openProjectCounts([{ owner: 'squadron', completedAt: null, abandonedAt: '  ' }]).squadron,
    ).toBe(1);
  });
});
