import { PrismaClient } from '@grims/db';
import type { IActivityStore } from './activity.recorder.js';

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

  async record(discordId: string, month: Date, at: Date, _messageId?: string): Promise<boolean> {
    await this.prisma.$executeRaw`
      INSERT INTO member_activity_months
        (discord_id, month, message_count, first_message_at, last_message_at)
      VALUES (${discordId}, ${month}::date, 1, ${at}, ${at})
      ON CONFLICT (discord_id, month) DO UPDATE SET
        message_count    = member_activity_months.message_count + 1,
        first_message_at = LEAST(member_activity_months.first_message_at, EXCLUDED.first_message_at),
        last_message_at  = GREATEST(member_activity_months.last_message_at, EXCLUDED.last_message_at),
        updated_at       = now()
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
