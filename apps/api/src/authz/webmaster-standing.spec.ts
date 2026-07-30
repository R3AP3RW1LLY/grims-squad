import { describe, it, expect } from 'vitest';
import {
  Permission,
  ALL_PERMISSIONS,
  WEBMASTER_PERMISSIONS,
  SQUADRON_STANDING_PERMISSIONS,
  SQUADRON_VOICE_PERMISSIONS,
  computeEffectiveMask,
} from '@grims/shared';
import { satisfiesMask } from '../forum/category.service.js';

/**
 * Running the website is not the same authority as speaking for the squadron.
 *
 * ★ THE INSTRUCTION ★
 *
 * Squadron owner, 2026-07-29: "webmaster should not be able to post to
 * Announcements, as this is for officers! if the webmaster obtains an officer
 * rank, then they can post in announcements. but the webmasters are not admins by
 * default in the squadron. they do need all website functions but not posting to
 * the web app announcements."
 *
 * The role carried `ALL_PERMISSIONS`, so whoever ran the website could post in the
 * squadron's name. The codebase already drew this line elsewhere — `isOfficer` is
 * a RANK question, and its comment says the webmaster "holds every permission on
 * the platform and no standing in the squadron at all" — the mask had simply never
 * been made to agree.
 */

/** What the seeded Announcements board demands to post in it. */
const ANNOUNCEMENTS_POST = Permission.FORUM_POST_OFFICER;
/** A members' board, for the "everything else still works" half. */
const GENERAL_POST = Permission.FORUM_POST_MEMBER;

describe('the webmaster role', () => {
  it('MANDATORY: cannot post in Announcements', () => {
    expect(satisfiesMask(WEBMASTER_PERMISSIONS, ANNOUNCEMENTS_POST)).toBe(false);
  });

  it('MANDATORY: still holds every other website function', () => {
    /*
     * The other half of the instruction, and the half that is easy to break by
     * over-correcting. Asserted as a SET DIFFERENCE rather than a list of
     * permissions I remembered to check — a permission added later is covered
     * automatically, which a hand-written list would not be.
     */
     const missing = ALL_PERMISSIONS & ~WEBMASTER_PERMISSIONS;
     expect(missing).toBe(SQUADRON_STANDING_PERMISSIONS);
  });

  it('can still post in the members boards', () => {
    expect(satisfiesMask(WEBMASTER_PERMISSIONS, GENERAL_POST)).toBe(true);
  });

  it('can still moderate, manage members and roles, and read the audit log', () => {
    // Support work. If any of these were stripped the role would stop being able
    // to do the job it exists for.
    for (const p of [
      Permission.FORUM_MODERATE,
      Permission.MEMBER_MANAGE,
      Permission.ROLE_MANAGE,
      Permission.AUDIT_VIEW,
      Permission.SITE_CONFIG,
    ]) {
      expect(satisfiesMask(WEBMASTER_PERMISSIONS, p)).toBe(true);
    }
  });

  it('MANDATORY: cannot SEE the officers board either', () => {
    /*
     * ★ THIS TEST ASSERTED THE OPPOSITE YESTERDAY, AND WAS RIGHT TO ★
     *
     * It read "can still SEE the officer boards, even though it cannot post",
     * arguing that support means being able to look at what somebody is reporting a
     * problem with. That was a reasonable reading of the first instruction, which
     * was only ever about POSTING.
     *
     * The second instruction settled it — "officers category should only be visible
     * to officers ... allow the webmaster to see this in development env only
     * please!" — so viewing is squadron standing too, and the support argument is
     * answered by the DEV grant rather than by a production capability.
     *
     * Kept as a rewrite rather than a deletion: the reversal is the interesting
     * part, and a reader who wonders why running the website does not include
     * reading the officers' board should find the answer here.
     */
    expect(satisfiesMask(WEBMASTER_PERMISSIONS, Permission.FORUM_VIEW_OFFICER)).toBe(false);
  });

  it('MANDATORY: no environment branch decides this', () => {
    /*
     * The instruction says "development env only", and the tempting implementation
     * is `if (process.env.NODE_ENV === 'development')` inside the visibility check.
     * That would mean the authorisation path taken in production is one development
     * never runs — the worst possible place for that to be true, and invisible in
     * every local test.
     *
     * So the mask is IDENTICAL in every environment and dev simply carries an extra
     * grant, added as data by `pnpm --filter @grims/db dev:grant-officer-view`.
     * This asserts the constant does not vary, which is the property that lets the
     * rest of the suite mean anything.
     */
    const saved = process.env.NODE_ENV;
    try {
      for (const env of ['development', 'test', 'production', undefined]) {
        process.env.NODE_ENV = env as string;
        expect(satisfiesMask(WEBMASTER_PERMISSIONS, Permission.FORUM_VIEW_OFFICER), env).toBe(false);
      }
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});

describe('a webmaster who is ALSO an officer', () => {
  /*
   * `computeEffectiveMask` ORs every held role together, which is what makes the
   * instruction work without a special case: the capability follows squadron
   * standing, and removing it from the webmaster role does not take it from an
   * officer who happens to run the website.
   */
  it('MANDATORY: CAN post in Announcements', () => {
    const officerRank = Permission.FORUM_POST_OFFICER | Permission.FORUM_VIEW_OFFICER;
    const effective = computeEffectiveMask([WEBMASTER_PERMISSIONS, officerRank]);

    expect(satisfiesMask(effective, ANNOUNCEMENTS_POST)).toBe(true);
  });

  it('loses it again if the officer rank is removed', () => {
    // The whole point of deriving it from held roles rather than storing a flag.
    const effective = computeEffectiveMask([WEBMASTER_PERMISSIONS]);
    expect(satisfiesMask(effective, ANNOUNCEMENTS_POST)).toBe(false);
  });

  it('a banned account holds nothing, officer rank or not', () => {
    // INV-037. 'banned', not 'suspended' — AccountStatus is
    // 'active' | 'inactive' | 'banned' | 'left', and the spec typecheck caught me
    // inventing a fifth. Worth asserting here because this is the file somebody will read
    // when reasoning about how the webmaster mask combines.
    const officerRank = Permission.FORUM_POST_OFFICER;
    const effective = computeEffectiveMask([WEBMASTER_PERMISSIONS, officerRank], 0n, 'banned');
    expect(effective).toBe(0n);
  });
});

describe('the squadron-standing set', () => {
  it('is exactly the squadron’s voice and its private room', () => {
    /*
     * Two bits, pinned so that widening the set is a visible edit to this test:
     *
     *   FORUM_POST_OFFICER  Announcements and the Squadron Log — speaking for the
     *                       squadron.
     *   FORUM_VIEW_OFFICER  the officers' board — reading its private room.
     *
     * Other candidates — BGS_SET_ORDERS, OPS_CREATE, OPS_MANAGE,
     * FLEET_APPROVE_DOCTRINE — are arguably squadron authority too, and are NOT
     * included because the same instruction says the webmaster needs every website
     * function. Widening this should be somebody's decision rather than an
     * inference.
     */
    expect(SQUADRON_STANDING_PERMISSIONS).toBe(
      Permission.FORUM_POST_OFFICER | Permission.FORUM_VIEW_OFFICER,
    );
  });

  it('is a subset of ALL_PERMISSIONS', () => {
    // A bit outside ALL_PERMISSIONS would be silently unreachable, and the
    // subtraction would be a no-op nobody noticed.
    expect(SQUADRON_STANDING_PERMISSIONS & ~ALL_PERMISSIONS).toBe(0n);
  });

  it('is still reachable under its old name, which callers may hold', () => {
    // Renamed from SQUADRON_VOICE_PERMISSIONS when it grew past "voice". The alias
    // exists so nothing breaks silently; asserted so the two cannot drift apart.
    expect(SQUADRON_VOICE_PERMISSIONS).toBe(SQUADRON_STANDING_PERMISSIONS);
  });
});
