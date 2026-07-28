import { PrismaClient } from '@grims/db';
import type { IActivityStore, ActivityKind } from './activity.recorder.js';

/**
 * Prisma-backed activity store.
 *
 * The write is a single upsert with SQL-side arithmetic rather than
 * read-modify-write. Two messages arriving in the same millisecond from
 * different shards would otherwise both read the same count and both write
 * count+1, losing one — and the loss would be invisible, because the number
 * would still look plausible.
 *
 * `first_message_at` uses LEAST and `last_message_at` GREATEST, so replaying an
 * older message during backfill cannot drag the first-seen time forward or the
 * last-seen time backward.
 */
export class PrismaActivityStore implements IActivityStore {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Adds one event to a member's month.
   *
   * ★ THIS DOES NOT DEDUPLICATE, AND THE CALLER MUST NOT ASSUME IT DOES ★
   *
   * `_eventId` is accepted and ignored. Idempotency comes from the CHECKPOINT
   * WATERMARK instead: the backfill only ever fetches messages after the
   * highest snowflake it has already recorded for that channel, so a message
   * cannot be presented twice in the first place.
   *
   * Written down because the parameter looks like a dedupe key and is not one.
   * Anything that records an event WITHOUT a monotonic watermark behind it —
   * voice occupancy at startup, for instance — has to guard itself, or a
   * restart adds a duplicate every time.
   */
  async record(
    discordId: string,
    month: Date,
    at: Date,
    kind: ActivityKind = 'message',
    _eventId?: string,
  ): Promise<boolean> {
    // Which counter moves is decided HERE and passed as three literals, rather
    // than interpolating a column name into the SQL. A column name built from a
    // value is an injection point, and `kind` ultimately originates from a
    // gateway payload.
    const m = kind === 'message' ? 1 : 0;
    const f = kind === 'forum' ? 1 : 0;
    const v = kind === 'voice' ? 1 : 0;

    await this.prisma.$executeRaw`
      INSERT INTO member_activity_months
        (discord_id, month, message_count, forum_post_count, voice_join_count,
         first_activity_at, last_activity_at)
      VALUES (${discordId}, ${month}::date, ${m}, ${f}, ${v}, ${at}, ${at})
      ON CONFLICT (discord_id, month) DO UPDATE SET
        message_count     = member_activity_months.message_count    + ${m},
        forum_post_count  = member_activity_months.forum_post_count + ${f},
        voice_join_count  = member_activity_months.voice_join_count + ${v},
        first_activity_at = LEAST(member_activity_months.first_activity_at, EXCLUDED.first_activity_at),
        last_activity_at  = GREATEST(member_activity_months.last_activity_at, EXCLUDED.last_activity_at),
        updated_at        = now()
    `;
    return true;
  }

  /**
   * Links activity rows to a user account once they sign in to the website.
   *
   * Deliberately retroactive: a member's Discord activity is recorded from the
   * day the bot sees them, which is usually long before they ever visit the
   * site. Without this, signing in would produce a profile showing no history.
   */
  async linkUser(discordId: string, userId: string): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE member_activity_months
      SET user_id = ${userId}::uuid, updated_at = now()
      WHERE discord_id = ${discordId} AND user_id IS DISTINCT FROM ${userId}::uuid
    `;
  }
}

/** Key/value checkpoints. Used for the backfill watermark. */
export class PrismaCheckpointStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(key: string): Promise<string | null> {
    const row = await this.prisma.botCheckpoint.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.botCheckpoint.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}
