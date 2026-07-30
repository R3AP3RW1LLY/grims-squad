import { describe, it, expect } from 'vitest';
import {
  Permission,
  ALL_PERMISSIONS,
  WEBMASTER_PERMISSIONS,
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
     expect(missing).toBe(SQUADRON_VOICE_PERMISSIONS);
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

  it('can still SEE the officer boards, even though it cannot post', () => {
    // Support means being able to look at what somebody is reporting a problem
    // with. Viewing and speaking are different things.
    expect(satisfiesMask(WEBMASTER_PERMISSIONS, Permission.FORUM_VIEW_OFFICER)).toBe(true);
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

describe('the squadron-voice set', () => {
  it('is deliberately minimal, and says so', () => {
    /*
     * Only FORUM_POST_OFFICER. Other candidates — BGS_SET_ORDERS, OPS_CREATE,
     * OPS_MANAGE, FLEET_APPROVE_DOCTRINE — are arguably squadron authority too,
     * and were NOT included because the same instruction says the webmaster needs
     * every website function. Widening this should be somebody's decision rather
     * than an inference from an instruction about announcements.
     *
     * Pinned so that widening it is a visible edit to this test.
     */
    expect(SQUADRON_VOICE_PERMISSIONS).toBe(Permission.FORUM_POST_OFFICER);
  });

  it('is a subset of ALL_PERMISSIONS', () => {
    // A bit outside ALL_PERMISSIONS would be silently unreachable, and the
    // subtraction would be a no-op nobody noticed.
    expect(SQUADRON_VOICE_PERMISSIONS & ~ALL_PERMISSIONS).toBe(0n);
  });
});
