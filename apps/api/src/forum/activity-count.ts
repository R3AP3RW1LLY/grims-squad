import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * Recording one forum post against a member's activity.
 *
 * ★ WHY THIS IS ITS OWN MODULE ★
 *
 * It lived as a private method on `PostService`, which meant only posts created THROUGH
 * `PostService` were ever counted — and the opening post of a thread is not one of them. It is
 * created nested inside the thread insert (`ThreadService.#create`), for the same reason the
 * screening bug lived there: the nested create is easy to miss because it does not look like a
 * post being created at all.
 *
 * So replies counted and thread openers did not. Reported by the squadron owner on 2026-08-05:
 * "the website is not tracking forum posts in the chart on the /app page". Production held eleven
 * posts across five threads — five of them openers — and every daily row read zero.
 *
 * A shared function rather than a second copy: the day/month pair, the UTC boundary and the
 * snowflake lookup all have to agree between the two call sites, and two implementations of that
 * would drift the first time one was fixed.
 *
 * ★ UTC DAY, MATCHING THE BOT AND THE PROMOTION RUN ★
 *
 * The bot writes the same table for Discord messages and voice, and promotions count a month.
 * Using the server's local day would put a host in a negative offset one day out at every month
 * boundary, and the figure a member reads would disagree with the one the promotion job used.
 *
 * ★ KEYED ON THE DISCORD SNOWFLAKE ★
 *
 * `member_activity_days` is keyed on `discord_id`, not on our user id, because it covers every
 * guild member whether or not they have ever signed in. A poster is therefore resolved through
 * their linked Discord identity, and somebody with no linked identity is not counted — which is
 * correct: they have no row in a table keyed by a snowflake they do not have.
 */
export async function countForumPost(db: AclBoundClient, authorId: string): Promise<void> {
  const identity = await db.discordIdentity.findFirst({
    where: { userId: authorId },
    // `userId` too: the month row carries it, and one created here would otherwise have none —
    // which is the column that joins an activity row back to a member.
    select: { discordId: true, userId: true },
  });
  if (identity === null) return;

  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  await db.memberActivityDay.upsert({
    where: { discordId_day: { discordId: identity.discordId, day } },
    create: { discordId: identity.discordId, day, forumPostCount: 1 },
    update: { forumPostCount: { increment: 1 } },
  });

  /*
   * ★ AND THE MONTH ★
   *
   * Every read of forum activity — the admin dashboard, the activity table, and the promotion
   * eligibility check — goes to `member_activity_months`. A day row alone counts towards nothing.
   */
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await db.memberActivityMonth.upsert({
    where: { discordId_month: { discordId: identity.discordId, month } },
    create: {
      discordId: identity.discordId,
      month,
      userId: authorId,
      forumPostCount: 1,
    },
    update: { forumPostCount: { increment: 1 } },
  });
}
