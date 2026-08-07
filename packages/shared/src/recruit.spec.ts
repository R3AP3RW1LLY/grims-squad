import { describe, expect, it } from 'vitest';
import {
  canMintInvite,
  milestonePoints,
  RECRUIT_MILESTONES,
  type MintCheck,
} from './recruit.js';
import { Permission } from './permissions.js';

/**
 * Who may hand out an invite, and what a recruit is worth.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "a unique discord invite link for all members that are inara veriefied in our platform ... the
 * minimum rant to do this is Cadet please ... we want to encourage our playerbase to beable to
 * invite people into the squadron!"
 *
 * ★ THE REASON THE ANSWER IS A REASON, NOT A BOOLEAN ★
 *
 * Three separate things can stop somebody minting a link, and they need three different sentences.
 * "You cannot do this" to a member who is one Inara key away from being able to is a dead end; "add
 * your Inara key and this unlocks" is an invitation. A bare false makes the page unable to tell
 * them apart.
 */

const ABLE: MintCheck = {
  mask: Permission.RECRUIT_INVITE,
  inaraVerified: true,
  rankOrder: 100,
};

describe('who may mint an invite', () => {
  it('MANDATORY: a verified Cadet with the permission may', () => {
    expect(canMintInvite(ABLE).allowed).toBe(true);
  });

  it('MANDATORY: an unverified member may not, and is told what to do about it', () => {
    /*
     * The gate that matters most: a link is the squadron's front door, and verification is the
     * cheapest defence against somebody minting one from a throwaway account.
     */
    const out = canMintInvite({ ...ABLE, inaraVerified: false });

    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('inara');
  });

  it('MANDATORY: below Cadet may not', () => {
    // The owner's line, and a good one: Cadet is a qualifying month, so they have actually been here.
    const out = canMintInvite({ ...ABLE, rankOrder: 99 });

    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('rank');
  });

  it('MANDATORY: no rank at all may not', () => {
    // Unranked is not "below Cadet" by accident — it is somebody with no tenure role whatsoever.
    expect(canMintInvite({ ...ABLE, rankOrder: null }).reason).toBe('rank');
  });

  it('MANDATORY: without the permission may not, however senior', () => {
    /*
     * This is the case the permission exists FOR. An officer who has been abusing invites can be
     * stopped without touching their rank — otherwise the only lever is a demotion, which punishes
     * a month of service to solve an afternoon's problem.
     */
    const out = canMintInvite({ ...ABLE, mask: 0n, rankOrder: 190 });

    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('permission');
  });

  it('MANDATORY: the permission is checked FIRST, so a revoked member is told the truth', () => {
    /*
     * Somebody whose permission was pulled AND who has not verified would otherwise be told to add
     * an Inara key — and would do it, and still be refused. The most specific true answer wins.
     */
    const out = canMintInvite({ mask: 0n, inaraVerified: false, rankOrder: 50 });

    expect(out.reason).toBe('permission');
  });
});

describe('what a recruit is worth', () => {
  it('MANDATORY: arriving is worth nothing', () => {
    /*
     * ★ THE DECISION THE WHOLE BOARD RESTS ON ★
     *
     * Pay per join and this is an alt-account farm: ten throwaway accounts in an evening tops the
     * board and the squadron gets ten empty seats. The join is recorded and shown to the recruiter,
     * and it scores zero.
     */
    expect(milestonePoints('joined')).toBe(0);
  });

  it('MANDATORY: every other milestone pays, and reaching Cadet pays most', () => {
    expect(milestonePoints('stayed')).toBeGreaterThan(0);
    expect(milestonePoints('verified')).toBeGreaterThan(milestonePoints('stayed'));
    expect(milestonePoints('cadet')).toBeGreaterThan(milestonePoints('verified'));
  });

  it('MANDATORY: the ladder ascends, so a later milestone is never worth less', () => {
    /*
     * A recruiter watching their own tracker should never see the reward go DOWN as their recruit
     * gets further in. Ordering is the promise the page makes.
     */
    const paid = RECRUIT_MILESTONES.filter((m) => m !== 'joined').map(milestonePoints);

    for (let i = 1; i < paid.length; i += 1) {
      expect(paid[i], `${RECRUIT_MILESTONES[i + 1]} pays less than the step before it`).toBeGreaterThanOrEqual(
        paid[i - 1] as number,
      );
    }
  });

  it('MANDATORY: an unknown milestone is worth nothing, never a guess', () => {
    // A milestone added to the database by a later version must not score under an older worker.
    expect(milestonePoints('something-we-do-not-know' as never)).toBe(0);
  });
});
