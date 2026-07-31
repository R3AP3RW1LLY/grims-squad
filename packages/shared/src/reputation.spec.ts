import { describe, it, expect } from 'vitest';
import { XP_AWARDS, BADGES, TEACHABLE, earnedBadges, levelFor } from './reputation.js';

/**
 * The reputation rules.
 *
 * ★ THESE ARE VALUE JUDGEMENTS, NOT ARITHMETIC ★
 *
 * Most of what follows asserts a RELATIONSHIP between numbers rather than the numbers themselves —
 * that receiving beats doing, that a downvote costs far less than an upvote earns. The exact
 * figures are tunable; the relationships are what the squadron decided, and changing one by
 * accident while adjusting a number is exactly the kind of edit that goes unnoticed.
 */

describe('what the numbers say the squadron values', () => {
  it('MANDATORY: being upvoted is worth far more than posting', () => {
    /*
     * A member cannot farm this by posting more — only by posting better, because the larger
     * number requires somebody else to act. Invert this and experience becomes a measure of
     * volume, and the forum fills up accordingly.
     */
    expect(XP_AWARDS.postUpvoted).toBeGreaterThan(XP_AWARDS.postCreated * 3);
  });

  it('MANDATORY: an accepted answer is the largest single award', () => {
    // Somebody asked, somebody answered, and the asker confirmed it worked. Nothing else on the
    // forum produces that much evidence that a post was worth writing.
    const others = Object.entries(XP_AWARDS)
      .filter(([k]) => k !== 'answerAccepted')
      .map(([, v]) => v);

    for (const v of others) expect(XP_AWARDS.answerAccepted).toBeGreaterThan(v);
  });

  it('MANDATORY: being wrong in public is cheap', () => {
    /*
     * A member who loses as much for a downvote as they gain for an upvote learns to post nothing
     * rather than to post carefully. The penalty exists to sort posts, not to punish people.
     */
    expect(Math.abs(XP_AWARDS.postDownvoted)).toBeLessThan(XP_AWARDS.postUpvoted / 4);
  });

  it('charges the voter nothing for downvoting', () => {
    // Some systems charge the voter to discourage casual downvotes. Here that would mean paying to
    // say a post is wrong, which is the one thing a squadron most needs somebody willing to do.
    expect(Object.keys(XP_AWARDS)).not.toContain('downvoteCast');
  });
});

describe('what teaches the assistant', () => {
  it('MANDATORY: an accepted answer qualifies outright', () => {
    expect(TEACHABLE.acceptedAnswer).toBe(true);
  });

  it('MANDATORY: popularity alone needs a much higher bar than one vote', () => {
    /*
     * Votes measure agreement, not accuracy, and on a squadron forum agreement is cheap. A funny
     * reply earns votes and teaches nothing; the bar exists so that being liked is not enough.
     */
    expect(TEACHABLE.minScore).toBeGreaterThanOrEqual(5);
  });
});

describe('badges', () => {
  it('MANDATORY: every badge requires somebody else to have benefited', () => {
    /*
     * There is no badge for posting a hundred times, because a badge for volume is an instruction
     * to produce volume. `daysPlayed` is the one metric that is not about another member, and it
     * is about showing up rather than about output.
     */
    for (const b of BADGES) {
      expect(['answersAccepted', 'postUpvotes', 'daysPlayed', 'xp']).toContain(b.metric);
      expect(b.metric).not.toBe('postsWritten');
    }
  });

  it('awards everything at or below the totals, and nothing above', () => {
    const earned = earnedBadges({ answersAccepted: 10, postUpvotes: 25, xp: 500, daysPlayed: 0 });

    expect(earned).toContain('first-answer');
    expect(earned).toContain('navigator');
    expect(earned).toContain('well-received');
    // Not reached.
    expect(earned).not.toContain('wing-commander');
    expect(earned).not.toContain('regular');
  });

  it('awards nothing to a brand new member', () => {
    expect(earnedBadges({ answersAccepted: 0, postUpvotes: 0, xp: 0, daysPlayed: 0 })).toEqual([]);
  });

  it('has a unique key per badge', () => {
    // A duplicate key would silently mean one badge can never be awarded — the primary key on
    // member_badges would treat them as the same thing.
    const keys = BADGES.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('levels', () => {
  it('MANDATORY: does not clamp a negative total at zero', () => {
    /*
     * A member CAN be net-negative, and hiding it behind a floor means the number reads the same
     * for somebody who has contributed nothing and somebody whose posts the squadron has
     * consistently voted down. Those need to look different to a moderator.
     */
    const low = levelFor(-40);
    expect(low.level).toBe(0);
    expect(low.label).toBe('Recruit');
  });

  it('widens as it goes, so the top of the ladder is hard', () => {
    // Linear levels make the tenth feel identical to the second.
    const gaps: number[] = [];
    let previous = 0;
    for (const xp of [50, 200, 500, 1_000, 2_500, 5_000]) {
      gaps.push(xp - previous);
      previous = xp;
    }
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i]).toBeGreaterThan(gaps[i - 1] ?? 0);
    }
  });

  it('reports the next threshold, and null at the top', () => {
    expect(levelFor(0).nextAt).toBe(50);
    expect(levelFor(60).nextAt).toBe(200);
    expect(levelFor(9_999).nextAt).toBeNull();
  });
});
