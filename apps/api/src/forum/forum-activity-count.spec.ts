import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countForumPost } from './activity-count.js';
import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * Does writing on the forum count as activity?
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "the website is not tracking forum posts in the chart on the /app page! we need this working in
 * full please and tracking forum posts as we track all other data in that chart please!"
 *
 * The chart was right, the aggregation was right, and the column was zero. `PostService.create`
 * recorded every reply — and the OPENING post of a thread never passes through it, because it is
 * created nested inside the thread insert. Production held eleven posts across five threads, five
 * of them openers, and `member_activity_days.forum_post_count` was zero on every single day.
 *
 * Two tests, because the bug had two halves: the counter has to be right, and BOTH paths have to
 * call it. The second half is what a unit test of the counter alone would have missed — and did.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

interface Upserted {
  readonly table: 'day' | 'month';
  readonly where: unknown;
  readonly create: Record<string, unknown>;
  readonly update: Record<string, unknown>;
}

function fakeDb(identity: { discordId: string; userId: string } | null) {
  const writes: Upserted[] = [];
  const db = {
    discordIdentity: { findFirst: async () => identity },
    memberActivityDay: {
      upsert: async (args: any) => {
        writes.push({ table: 'day', ...args });
      },
    },
    memberActivityMonth: {
      upsert: async (args: any) => {
        writes.push({ table: 'month', ...args });
      },
    },
  } as unknown as AclBoundClient;
  return { db, writes };
}

describe('counting a forum post', () => {
  it('MANDATORY: writes BOTH the day and the month row', async () => {
    /*
     * Every read of forum activity — the admin dashboard, the activity table, and promotion
     * eligibility — goes to the MONTH table. An earlier version wrote only the day, so posting
     * counted towards the chart and towards nothing else, including promotions.
     */
    const { db, writes } = fakeDb({ discordId: '123', userId: 'u1' });
    await countForumPost(db, 'u1');

    expect(writes.map((w) => w.table)).toEqual(['day', 'month']);
    expect(writes[0]?.create).toMatchObject({ discordId: '123', forumPostCount: 1 });
    expect(writes[0]?.update).toEqual({ forumPostCount: { increment: 1 } });
    expect(writes[1]?.create).toMatchObject({ discordId: '123', userId: 'u1', forumPostCount: 1 });
    expect(writes[1]?.update).toEqual({ forumPostCount: { increment: 1 } });
  });

  it('the day and month are UTC boundaries, matching the bot and the promotion run', async () => {
    /*
     * The bot writes this same table for Discord messages and voice. A server in a negative offset
     * using its local day would be one day out at every month boundary, and the figure a member
     * reads would disagree with the one the promotion job used.
     */
    const { db, writes } = fakeDb({ discordId: '123', userId: 'u1' });
    await countForumPost(db, 'u1');

    const day = (writes[0]?.create as { day: Date }).day;
    const month = (writes[1]?.create as { month: Date }).month;

    expect(day.getUTCHours()).toBe(0);
    expect(day.getUTCMinutes()).toBe(0);
    expect(day.getUTCSeconds()).toBe(0);
    expect(month.getUTCDate()).toBe(1);
    expect(month.getUTCHours()).toBe(0);
  });

  it('somebody with no linked Discord identity is not counted, and does not crash', async () => {
    // The table is keyed on a snowflake they do not have. Not counting them is correct.
    const { db, writes } = fakeDb(null);
    await countForumPost(db, 'u1');
    expect(writes).toEqual([]);
  });

  it('MANDATORY: BOTH creation paths call it — replies and thread openers', () => {
    /*
     * ★ THE ASSERTION THAT WOULD HAVE CAUGHT THE BUG ★
     *
     * The counter was never wrong. It was simply not reached when a thread was STARTED, because
     * the opening post is created nested inside the thread insert and never touches
     * `PostService.create`. A unit test of the counter passes either way, which is exactly why
     * this file also reads the two call sites.
     *
     * A source scan rather than a wiring test: both services take a Prisma client and a screening
     * dependency, and standing the pair up to observe one fire-and-forget side effect would test
     * the harness more than the code.
     */
    const post = readFileSync(join(HERE, 'post.service.ts'), 'utf8');
    const thread = readFileSync(join(HERE, 'thread.service.ts'), 'utf8');

    expect(post, 'PostService no longer records a reply').toContain('countForumPost(db, authorId)');
    expect(thread, 'ThreadService does not record the opening post').toContain(
      'countForumPost(db, authorId)',
    );

    // And neither kept a private copy that could drift from the other.
    expect(post).not.toContain('async #countForumPost');
    expect(thread).not.toContain('async #countForumPost');
  });
});
