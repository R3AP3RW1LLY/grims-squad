import { describe, expect, it } from 'vitest';
import { whoInvited } from './invite-attribution.js';

/**
 * Working out whose link somebody came through.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "a unique discord invite link for all members ... please build me a cool recruit tracking system!"
 *
 * ★ DISCORD HAS NO "WHO INVITED THIS PERSON" FIELD ★
 *
 * The only technique available is counting. Every invite carries a `uses` number, so you remember
 * them all, and when somebody joins you look for the one that went up. That works perfectly for one
 * arrival at a time and is genuinely ambiguous for two at once — and the whole value of this
 * function is that it says which case it is instead of picking.
 *
 * A wrong attribution is worse than none. It credits points to somebody who did nothing, on a
 * leaderboard, publicly — and the member who actually did the recruiting watches it happen.
 */

describe('attributing a join', () => {
  it('MANDATORY: the one invite that went up is the answer', () => {
    const out = whoInvited(
      new Map([
        ['aaa', 4],
        ['bbb', 9],
      ]),
      new Map([
        ['aaa', 5],
        ['bbb', 9],
      ]),
    );

    expect(out).toEqual({ outcome: 'attributed', code: 'aaa' });
  });

  it('MANDATORY: two invites going up at once is ambiguous, never a guess', () => {
    /*
     * ★ THE RACE THIS FUNCTION EXISTS FOR ★
     *
     * Two people joining in the same instant through different links both increment before we can
     * look. Picking either is a coin toss that pays a stranger and robs the member who actually
     * brought somebody in. The recruiting manager assigns these by hand.
     */
    const out = whoInvited(
      new Map([
        ['aaa', 4],
        ['bbb', 9],
      ]),
      new Map([
        ['aaa', 5],
        ['bbb', 10],
      ]),
    );

    expect(out.outcome).toBe('ambiguous');
  });

  it('MANDATORY: nothing going up is unknown', () => {
    /*
     * Real and common: the guild's vanity URL, a widget invite, or somebody added by a bot. None of
     * them belong to a member, and inventing a recruiter for them would quietly award points for
     * arrivals nobody caused.
     */
    const same = new Map([['aaa', 4]]);

    expect(whoInvited(same, new Map(same)).outcome).toBe('unknown');
  });

  it('MANDATORY: an invite that appeared between snapshots and has been used is the answer', () => {
    /*
     * A member mints a link and somebody walks through it before the next refresh. The code is
     * absent from `before` entirely, so a naive diff sees no increase and credits nobody — losing
     * exactly the join a new recruiter is most excited about.
     */
    const out = whoInvited(new Map([['aaa', 4]]), new Map([['aaa', 4], ['new', 1]]));

    expect(out).toEqual({ outcome: 'attributed', code: 'new' });
  });

  it('MANDATORY: a brand-new invite nobody has used is not the answer', () => {
    // Minting a link is not somebody walking through it.
    const out = whoInvited(new Map([['aaa', 4]]), new Map([['aaa', 4], ['fresh', 0]]));

    expect(out.outcome).toBe('unknown');
  });

  it('MANDATORY: a jump of more than one is still that invite', () => {
    /*
     * Two arrivals through the SAME link between refreshes. Which member to credit is not in doubt
     * — it is their link either way — so this attributes rather than throwing up its hands.
     */
    const out = whoInvited(new Map([['aaa', 4]]), new Map([['aaa', 6]]));

    expect(out).toEqual({ outcome: 'attributed', code: 'aaa' });
  });

  it('MANDATORY: an invite that disappeared is ignored, not counted backwards', () => {
    /*
     * Invites expire and get deleted. A negative difference is not a join and must never be read as
     * one — and it must not stop the real answer beside it being found.
     */
    const out = whoInvited(
      new Map([
        ['gone', 7],
        ['aaa', 4],
      ]),
      new Map([['aaa', 5]]),
    );

    expect(out).toEqual({ outcome: 'attributed', code: 'aaa' });
  });

  it('MANDATORY: no snapshot at all is unknown, not a crash', () => {
    // The first join after a restart, before the cache has been built.
    expect(whoInvited(null, new Map([['aaa', 5]])).outcome).toBe('unknown');
    expect(whoInvited(new Map(), new Map()).outcome).toBe('unknown');
  });
});
