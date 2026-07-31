import type { PrismaClient } from '@prisma/client';
import { ArtworkQuota } from './artwork.service.js';

/**
 * Counting recent generations, from the log that already records them.
 *
 * ★ NO SEPARATE COUNTER TABLE, AND THAT IS THE POINT ★
 *
 * Every generation writes an `ai_calls` row because the owner required all AI conversations to be
 * reviewable. That table is therefore already the truth about who generated what and when, and a
 * second counter alongside it would be a second thing to keep in step — with the failure mode that
 * the limit and the audit trail disagree, and no way to tell which is right.
 *
 * The cost is a COUNT over an hour of rows on every attempt. At squadron scale that is nothing, and
 * `ai_calls` is indexed on `createdAt` for the review screen regardless.
 *
 * ★ REFUSALS COUNT TOWARDS THE LIMIT ★
 *
 * A rate-limited attempt writes a row with `refusedReason` set, and this counts it. That is
 * deliberate: not counting refusals means somebody at their limit can hammer the button and each
 * press re-queries a limit they will never clear, which is a way to make a rate limiter into a load
 * generator. Counting them means the hour rolls forward from the last ATTEMPT.
 */
export class PrismaArtworkQuota extends ArtworkQuota {
  constructor(private readonly db: PrismaClient) {
    super();
  }

  async byMember(userId: string): Promise<number> {
    return this.db.aiCall.count({
      where: { userId, kind: 'signature', createdAt: { gte: anHourAgo() } },
    });
  }

  async global(): Promise<number> {
    return this.db.aiCall.count({
      where: { kind: 'signature', createdAt: { gte: anHourAgo() } },
    });
  }
}

/**
 * A rolling hour, not a clock hour.
 *
 * A calendar window resets on the hour, so five generations at 10:58 and five more at 11:01 is ten
 * in three minutes — precisely the burst the limit exists to prevent. Rolling costs nothing extra
 * here and has no such edge.
 */
function anHourAgo(): Date {
  return new Date(Date.now() - 60 * 60 * 1000);
}
