import type { PrismaClient } from '@grims/db';

export interface SquadronStats {
  /** Members with an active account here. Not the same as the Discord headcount. */
  readonly members: number;
  /** Guild members the bot has seen activity from this month, account or not. */
  readonly activeThisMonth: number;
  /** Messages, forum posts and voice joins recorded this month, added together. */
  readonly activityThisMonth: number;
  /** Verified commander names. A count, never the names. */
  readonly verifiedCommanders: number;
  readonly foundedYear: number;
  readonly generatedAt: string;
}

export interface StatsStore {
  stats(): Promise<SquadronStats>;
}

/** The squadron's founding year. Fixed history, not a computed value. */
const FOUNDED = 2006;

export class PrismaStatsStore implements StatsStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async stats(): Promise<SquadronStats> {
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    // One round trip. Four sequential counts on the landing page's critical
    // path is four times the latency for no benefit.
    const [members, active, totals, verified] = await this.#db.$transaction([
      this.#db.user.count({ where: { status: 'active' } }),
      this.#db.memberActivityMonth.count({
        where: {
          month,
          OR: [
            { messageCount: { gt: 0 } },
            { forumPostCount: { gt: 0 } },
            { voiceJoinCount: { gt: 0 } },
          ],
        },
      }),
      this.#db.memberActivityMonth.aggregate({
        where: { month },
        _sum: { messageCount: true, forumPostCount: true, voiceJoinCount: true },
      }),
      this.#db.cmdrVerification.count({ where: { isVerified: true, revokedAt: null } }),
    ]);

    return {
      members,
      activeThisMonth: active,
      activityThisMonth:
        (totals._sum.messageCount ?? 0) +
        (totals._sum.forumPostCount ?? 0) +
        (totals._sum.voiceJoinCount ?? 0),
      verifiedCommanders: verified,
      foundedYear: FOUNDED,
      // Stamped so the page can say how fresh the numbers are rather than
      // implying they are live to the second.
      generatedAt: now.toISOString(),
    };
  }
}
