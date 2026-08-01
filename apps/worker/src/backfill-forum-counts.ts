import { PrismaClient } from '@grims/db';

/**
 * Rebuilding forum post counts from the posts themselves.
 *
 * ★ THE COLUMN WAS READ EVERYWHERE AND WRITTEN ALMOST NOWHERE ★
 *
 * `member_activity_months.forum_post_count` feeds the admin dashboard, the activity table and the
 * promotion eligibility check. Nothing had ever written it: 0 of 52 monthly rows carried a count,
 * against 16 real posts in the forum.
 *
 * The day rows were only slightly better — the increment was added after most of the posts existed,
 * so 1 day row out of 379 had a number in it, and that one said 2.
 *
 * Nothing failed and nothing was logged. The figure was simply always zero, which is exactly what
 * "nobody posts on the forum" looks like.
 *
 * ★ SET, NOT INCREMENT — SO IT CAN BE RUN TWICE ★
 *
 * Every count here is computed from `forum_posts` and written as an absolute value. A backfill that
 * added to what was there would double every number the second time somebody ran it, and the second
 * run is the one that happens by accident.
 *
 * That also makes this a repair tool rather than a one-off: if the counters ever drift again, this
 * puts them back to what the forum actually contains.
 *
 *   node apps/worker/dist/backfill-forum-counts.js          write
 *   node apps/worker/dist/backfill-forum-counts.js --dry    report only
 */

interface Tally {
  readonly discordId: string;
  readonly userId: string;
  readonly period: Date;
  readonly posts: number;
}

/**
 * Counts posts per member per period, joined to the Discord identity.
 *
 * ★ KEYED ON THE SNOWFLAKE, LIKE THE ROWS IT IS FILLING ★
 *
 * Activity rows are keyed by Discord id rather than user id, because the bot records them for guild
 * members who may never have signed in. A post has an author who HAS signed in, so the join is
 * needed — and a member with no linked Discord identity contributes nothing, which is correct:
 * there is no row for them to contribute to.
 *
 * Deleted posts are excluded. A post somebody removed should not go on earning them a promotion.
 */
async function tally(db: PrismaClient, unit: 'day' | 'month'): Promise<Tally[]> {
  return db.$queryRawUnsafe<Tally[]>(
    `SELECT di.discord_id                        AS "discordId",
            p.author_id                          AS "userId",
            date_trunc('${unit}', p.created_at AT TIME ZONE 'UTC') AS period,
            COUNT(*)::int                        AS posts
       FROM forum_posts p
       JOIN discord_identities di ON di.user_id = p.author_id
      WHERE p.deleted_at IS NULL
      GROUP BY 1, 2, 3`,
  );
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const db = new PrismaClient();

  try {
    const days = await tally(db, 'day');
    const months = await tally(db, 'month');

    console.log(
      `forum posts resolve to ${days.length} day rows and ${months.length} month rows` +
        `${dry ? ' (dry run, nothing written)' : ''}`,
    );

    if (dry) {
      for (const m of months.slice(0, 10)) {
        console.log(`  ${m.period.toISOString().slice(0, 7)}  ${m.discordId}  ${m.posts} posts`);
      }
      return;
    }

    /*
     * ★ ZEROED FIRST ★
     *
     * A member whose only post was deleted should end at zero, and an upsert alone would leave
     * their old number standing — the one case a backfill is most likely to be run to fix.
     */
    await db.memberActivityDay.updateMany({
      where: { forumPostCount: { gt: 0 } },
      data: { forumPostCount: 0 },
    });
    await db.memberActivityMonth.updateMany({
      where: { forumPostCount: { gt: 0 } },
      data: { forumPostCount: 0 },
    });

    for (const d of days) {
      await db.memberActivityDay.upsert({
        where: { discordId_day: { discordId: d.discordId, day: d.period } },
        create: { discordId: d.discordId, day: d.period, forumPostCount: d.posts },
        update: { forumPostCount: d.posts },
      });
    }

    for (const m of months) {
      await db.memberActivityMonth.upsert({
        where: { discordId_month: { discordId: m.discordId, month: m.period } },
        create: {
          discordId: m.discordId,
          month: m.period,
          userId: m.userId,
          forumPostCount: m.posts,
        },
        update: { forumPostCount: m.posts, userId: m.userId },
      });
    }

    const total = months.reduce((n, m) => n + m.posts, 0);
    console.log(`forum counts rebuilt: ${total} posts across ${months.length} member-months`);
  } finally {
    await db.$disconnect();
  }
}

await main();
