import type { PrismaClient } from '@grims/db';

export interface SquadronStats {
  /** People in the Discord guild, bots excluded. THIS is the squadron. */
  readonly members: number;
  /** Of those, how many have signed up here. */
  readonly withAccounts: number;
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
    const [members, withAccounts, active, totals, verified] = await this.#db.$transaction([
      /*
       * ★ THE SQUADRON IS THE GUILD, NOT THE WEBSITE ★
       *
       * This counted `users` — website accounts — which is ONE. The dashboard
       * then showed "Squadron 1" directly beside "Active this month 52", which
       * is not merely wrong but visibly absurd: fifty-two of one.
       *
       * The squadron is the people in Discord. Bots excluded, because they hold
       * roles and are not members. Having an account here is a separate fact
       * and is reported separately.
       */
      this.#db.discordGuildMember.count({ where: { isBot: false } }),
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
      withAccounts,
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
