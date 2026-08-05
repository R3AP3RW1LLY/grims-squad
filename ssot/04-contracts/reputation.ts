/**
 * Votes, experience and badges.
 *
 * ★ SQUADRON OWNER, 2026-07-31 ★
 *
 * "we also need upvote, downvote and answer buttons like stack overflow, we need to build these out
 * create an xp and badge system and use upvoted and posts that have been checked as the answer to
 * something as a way to train our ai chat system ... also we need to include in-game activity too."
 *
 * ★ TWO JOBS, AND THEY PULL IN DIFFERENT DIRECTIONS ★
 *
 * Reputation exists to reward members AND to select which forum posts are good enough to teach the
 * assistant from. Those are not the same goal: a funny reply earns votes and teaches nothing, and a
 * dry, correct answer to an obscure question is the opposite.
 *
 * So the two use different signals. XP counts everything a member does. The KNOWLEDGE ingest reads
 * only accepted answers and heavily-upvoted posts — see `TEACHABLE`. A post has to clear a bar
 * nobody can reach by being liked.
 *
 * ★ EVERYONE MAY DO EVERYTHING — OWNER'S DECISION, 2026-07-31 ★
 *
 * Asked whether voting should require standing, the answer was that every member can vote and every
 * member can accept an answer on their own thread. The risk was raised and the decision was made:
 * this is a hundred-and-seven-person squadron where everybody knows everybody, not an open
 * internet forum, and a reputation gate on a group that size mostly stops new members
 * participating.
 */

/** What a vote can be. No zero — removing a vote deletes the row. */
export const VOTE_VALUES = [1, -1] as const;
export type VoteValue = (typeof VOTE_VALUES)[number];

/**
 * Everything that earns experience, and what it is worth.
 *
 * ★ WHY RECEIVING BEATS DOING, EVERY TIME ★
 *
 * Writing a post is worth 2. Having that post upvoted is worth 10. The numbers say what the
 * squadron values: not volume, but posts other people found worth something. A member cannot farm
 * this by posting more — only by posting better, because the second number needs somebody else.
 *
 * ★ AND WHY A DOWNVOTE COSTS THE VOTER NOTHING ★
 *
 * Some systems charge the voter to discourage casual downvoting. Here that would mean a member
 * pays to say a post is wrong, which is the one thing a squadron most needs somebody to be willing
 * to do.
 */
export const XP_AWARDS = {
  /** Wrote a post. Small: the act itself is not the achievement. */
  postCreated: 2,
  /** Started a thread. Slightly more — a question nobody asks gets no answers. */
  threadCreated: 3,
  /** Somebody upvoted your post. */
  postUpvoted: 10,
  /**
   * Somebody downvoted your post.
   *
   * Negative, and deliberately much smaller than the upvote. It should be possible to be wrong in
   * public without it being expensive — a member who loses 10 for a bad answer learns to post
   * nothing rather than to post carefully.
   */
  postDownvoted: -2,
  /** Your answer was accepted as the solution. The largest single award there is. */
  answerAccepted: 25,
  /** You accepted an answer on your own thread. Closing a question helps everyone who finds it later. */
  answerAcceptedByYou: 2,
  /**
   * A day on which our telemetry saw them in the game.
   *
   * ★ PER DAY, NOT PER EVENT — owner asked for in-game activity to count ★
   *
   * Per event would reward whoever fires the most journal lines, which is a measure of what they
   * fly rather than of showing up. A day is a day whether it was spent mining or in a wing.
   */
  playedToday: 5,
} as const;

export type XpReason = keyof typeof XP_AWARDS;

/**
 * The bar a forum post must clear to teach the assistant.
 *
 * ★ NOT THE SAME BAR AS BEING POPULAR ★
 *
 * An accepted answer qualifies outright: somebody asked, somebody answered, and the person who
 * asked confirmed it worked. That is the strongest correctness signal a forum can produce.
 *
 * Score alone needs a much higher bar, because votes measure agreement rather than accuracy — and
 * on a squadron forum, agreement is cheap.
 */
export const TEACHABLE = {
  /** An accepted solution always qualifies. */
  acceptedAnswer: true,
  /** Otherwise, the net score a post needs. Five people in a squadron of a hundred is a real signal. */
  minScore: 5,
} as const;

/**
 * Badges.
 *
 * ★ EARNED FOR THINGS THAT HELP SOMEBODY ELSE ★
 *
 * Every one of these requires another member to have benefited. There is no badge for posting a
 * hundred times, because a badge for volume is an instruction to post volume.
 */
export interface BadgeDefinition {
  readonly key: string;
  readonly label: string;
  /** Shown to the member. Says what they did, not what the rule is. */
  readonly description: string;
  /** What is counted. */
  readonly metric: 'answersAccepted' | 'postUpvotes' | 'xp' | 'daysPlayed';
  readonly threshold: number;
}

export const BADGES: readonly BadgeDefinition[] = [
  {
    key: 'first-answer',
    label: 'First Answer',
    description: 'Answered a question, and the person who asked said it worked.',
    metric: 'answersAccepted',
    threshold: 1,
  },
  {
    key: 'navigator',
    label: 'Navigator',
    description: 'Ten accepted answers. Members come to you when they are stuck.',
    metric: 'answersAccepted',
    threshold: 10,
  },
  {
    key: 'wing-commander',
    label: 'Wing Commander',
    description: 'Fifty accepted answers.',
    metric: 'answersAccepted',
    threshold: 50,
  },
  {
    key: 'well-received',
    label: 'Well Received',
    description: 'Twenty-five upvotes across your posts.',
    metric: 'postUpvotes',
    threshold: 25,
  },
  {
    key: 'squadron-voice',
    label: 'Squadron Voice',
    description: 'Two hundred upvotes across your posts.',
    metric: 'postUpvotes',
    threshold: 200,
  },
  {
    key: 'regular',
    label: 'Regular',
    description: 'Thirty days flying with the squadron on record.',
    metric: 'daysPlayed',
    threshold: 30,
  },
  {
    key: 'veteran',
    label: 'Veteran',
    description: 'Three hundred and sixty-five days on record.',
    metric: 'daysPlayed',
    threshold: 365,
  },
];

/**
 * Which badges a set of totals has earned.
 *
 * Pure, so the rule can be tested without a database — and so the same function decides both what
 * to award tonight and what a member's profile displays, which is the only way those two can never
 * disagree.
 */
export function earnedBadges(totals: {
  answersAccepted: number;
  postUpvotes: number;
  xp: number;
  daysPlayed: number;
}): string[] {
  return BADGES.filter((b) => totals[b.metric] >= b.threshold).map((b) => b.key);
}

/**
 * A member's standing, as shown next to their name.
 *
 * ★ XP IS NOT CLAMPED AT ZERO ★
 *
 * A member can be net-negative, and that is honest. Hiding it behind a floor would mean the number
 * says the same thing for somebody who has contributed nothing and somebody whose posts the
 * squadron has consistently voted down — and those need to look different to a moderator.
 */
export function levelFor(xp: number): { level: number; label: string; nextAt: number | null } {
  /*
   * Thresholds widen as they go: 0, 50, 200, 500, 1000, 2500, 5000. Linear levels make the tenth
   * feel identical to the second, and the point of a ladder is that the top of it is hard.
   */
  const STEPS = [0, 50, 200, 500, 1_000, 2_500, 5_000];
  const LABELS = ['Recruit', 'Cadet', 'Pilot', 'Wingman', 'Veteran', 'Elite', 'Legend'];

  let level = 0;
  for (let i = 0; i < STEPS.length; i += 1) {
    const step = STEPS[i];
    if (step !== undefined && xp >= step) level = i;
  }

  return {
    level,
    label: LABELS[level] ?? 'Recruit',
    nextAt: STEPS[level + 1] ?? null,
  };
}
