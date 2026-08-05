import { notifyMembers, type LiveNudge, type PrismaClient } from '@grims/db';
import { XP_AWARDS, BADGES, badgeDisplay, earnedBadges } from '@grims/shared';

/**
 * Nightly reputation: experience for showing up, and badges for what that adds to.
 *
 * ★ WHY ANY OF THIS IS A JOB AT ALL ★
 *
 * Votes and accepted answers award experience the moment they happen — they are events, and the
 * request that causes them is the right place to record them.
 *
 * These two are not events. "Played today" is a fact about a DAY that is only true once the day
 * has some telemetry in it, and a badge is a threshold crossed by a total that several different
 * actions can move. Both are questions you ask about accumulated state, and asking them once a
 * night is both cheaper and more correct than trying to detect the crossing inside every write
 * that might have caused it.
 */

export interface ReputationReport {
  /** Play-days awarded this run. */
  readonly playDays: number;
  /** Badges newly earned. */
  readonly badges: number;
  /** Members considered. */
  readonly members: number;
}

/**
 * Awards experience for every day a member's telemetry shows them in the game.
 *
 * ★ PER DAY, NOT PER EVENT — the owner asked for in-game activity to count ★
 *
 * Per event would reward whoever produces the most journal lines, which measures what somebody
 * flies rather than whether they turned up. A day is a day whether it was spent mining or in a
 * wing.
 *
 * ★ IDEMPOTENT BY CONSTRUCTION ★
 *
 * `skipDuplicates` against the partial unique index on (user_id, reason, subject) means a re-run
 * awards nothing twice — and re-runs happen: a retry, a manual invocation, two cron entries that
 * overlap. A ledger that double-counts is worse than no ledger, because it still looks
 * authoritative.
 *
 * The date is the SUBJECT, which is what makes that index able to tell one day from another.
 */
export async function awardPlayDays(db: PrismaClient): Promise<number> {
  const days = await db.$queryRawUnsafe<Array<{ user_id: string; day: string }>>(
    `SELECT DISTINCT user_id,
            to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
       FROM telemetry_events
      /*
       * Bounded to the last 90 days.
       *
       * A first install replays MONTHS of journals, and without this the first run after somebody
       * joins would award them years of back-dated play for days before they were a member. It
       * also stops the query growing with the archive rather than with the work.
       */
      WHERE occurred_at > now() - interval '90 days'`,
  );

  if (days.length === 0) return 0;

  const result = await db.xpEvent.createMany({
    data: days.map((d) => ({
      userId: d.user_id,
      reason: 'playedToday',
      amount: XP_AWARDS.playedToday,
      subject: d.day,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

/**
 * Awards badges whose thresholds a member has crossed.
 *
 * ★ THE TOTALS ARE COMPUTED, THE BADGES ARE STORED ★
 *
 * `earnedBadges` decides from totals, and the same function serves this job and the profile
 * display — which is the only way those two can never disagree about what somebody has earned.
 *
 * What is STORED is the badge and the date. Recomputing the date on read would say a member earned
 * it today, every day, and "since March" is most of what a badge is worth.
 */
export async function awardBadges(
  db: PrismaClient,
  nudge?: LiveNudge,
): Promise<{ awarded: number; members: number }> {
  /*
   * One query for everybody's totals rather than one per member.
   *
   * Four separate aggregates over three tables, joined per member. At a hundred and seven members
   * this could be done in a loop and nobody would notice; it is written this way because the loop
   * version is the one that quietly becomes four hundred queries when the squadron doubles.
   */
  const totals = await db.$queryRawUnsafe<
    Array<{
      user_id: string;
      xp: bigint;
      answers_accepted: bigint;
      post_upvotes: bigint;
      days_played: bigint;
    }>
  >(
    `SELECT u.id AS user_id,
            COALESCE(x.total, 0)     AS xp,
            COALESCE(a.n, 0)         AS answers_accepted,
            COALESCE(v.n, 0)         AS post_upvotes,
            COALESCE(d.n, 0)         AS days_played
       FROM users u
       LEFT JOIN (SELECT user_id, SUM(amount)::bigint AS total FROM xp_events GROUP BY 1) x
              ON x.user_id = u.id
       -- Accepted answers they WROTE. Not ones they accepted — that is a different award.
       LEFT JOIN (SELECT author_id, COUNT(*)::bigint AS n FROM forum_posts
                   WHERE is_solution = true AND deleted_at IS NULL GROUP BY 1) a
              ON a.author_id = u.id
       -- Upvotes ACROSS their posts, which is why this joins through forum_posts rather than
       -- counting rows in forum_votes by voter.
       LEFT JOIN (SELECT p.author_id, COUNT(*)::bigint AS n
                    FROM forum_votes fv
                    JOIN forum_posts p ON p.id = fv.post_id
                   WHERE fv.value = 1 AND p.deleted_at IS NULL
                   GROUP BY 1) v
              ON v.author_id = u.id
       LEFT JOIN (SELECT user_id, COUNT(*)::bigint AS n FROM xp_events
                   WHERE reason = 'playedToday' GROUP BY 1) d
              ON d.user_id = u.id`,
  );

  const held = await db.memberBadge.findMany({ select: { userId: true, badgeKey: true } });
  const already = new Set(held.map((h) => `${h.userId}:${h.badgeKey}`));

  const fresh: Array<{ userId: string; badgeKey: string }> = [];
  for (const t of totals) {
    const keys = earnedBadges({
      xp: Number(t.xp),
      answersAccepted: Number(t.answers_accepted),
      postUpvotes: Number(t.post_upvotes),
      daysPlayed: Number(t.days_played),
    });
    for (const key of keys) {
      if (already.has(`${t.user_id}:${key}`)) continue;
      fresh.push({ userId: t.user_id, badgeKey: key });
    }
  }

  if (fresh.length === 0) return { awarded: 0, members: totals.length };

  /*
   * `skipDuplicates` as well as the check above. The check keeps the insert small; this is what
   * makes a race between two runs harmless rather than a primary-key violation that aborts the
   * whole batch and loses everybody else's badges too.
   */
  const result = await db.memberBadge.createMany({ data: fresh, skipDuplicates: true });

  /*
   * ★ badge.earned — TOLD FROM THE `fresh` LIST, WHICH IS THE DIFF ★
   *
   * `fresh` is exactly what this run computed as newly earned: everything a member holds minus
   * the `held` set read above, so a nightly re-run announces nothing twice. The rare race two
   * overlapping runs can produce — both computing the same diff before either writes — costs a
   * repeated notice, the same rows `skipDuplicates` already tolerates; a notification is the one
   * artefact here that has no unique key to lean on, and that trade is accepted.
   *
   * Grouped per member: a first sweep over a veteran's history can land four badges at once, and
   * four rows beat four separate pushes nobody reads. Never allowed to fail the sweep — the
   * badges are in the table by now.
   */
  try {
    const byMember = new Map<string, string[]>();
    for (const f of fresh) {
      byMember.set(f.userId, [...(byMember.get(f.userId) ?? []), f.badgeKey]);
    }

    for (const [userId, keys] of byMember) {
      const displays = keys
        .map((key) => badgeDisplay(key))
        .filter((d): d is NonNullable<typeof d> => d !== null);
      if (displays.length === 0) continue;

      const first = displays[0];
      if (first === undefined) continue;

      await notifyMembers(
        db,
        [userId],
        {
          kind: 'badge.earned',
          title:
            displays.length === 1
              ? `Badge earned: ${first.name}`
              : `Badges earned: ${displays.map((d) => d.name).join(', ')}`,
          body:
            displays.length === 1
              ? `${first.icon} ${first.description}`
              : 'Your forum and activity record crossed new thresholds tonight.',
          link: '/leaderboards',
        },
        nudge,
      );
    }
  } catch {
    // The awards already landed; a bell must never un-land them.
  }

  return { awarded: result.count, members: totals.length };
}

/** Both, in the order they depend on each other: play-days feed the `daysPlayed` badges. */
export async function runReputation(db: PrismaClient, nudge?: LiveNudge): Promise<ReputationReport> {
  const playDays = await awardPlayDays(db);
  const { awarded, members } = await awardBadges(db, nudge);
  return { playDays, badges: awarded, members };
}

/** Every badge key the job can award. Exported so a test can pin it against the contract. */
export const AWARDABLE = BADGES.map((b) => b.key);
