import type { PrismaClient } from '@grims/db';

/**
 * The numbers behind the admin dashboard.
 *
 * ★ AGGREGATES ONLY, AND THAT IS A PRIVACY DECISION ★
 *
 * Every figure here is a count or a total across the squadron. Nothing returns
 * one member's location, credits, or what they were doing — those are governed
 * by their own consent toggles, and a dashboard is exactly the sort of place
 * that would quietly become a way around them.
 *
 * The two exceptions are deliberate and narrow: the most active members by
 * message count, which is what the promotion system already publishes to
 * officers, and the busiest ship types, which name a ship model and nobody.
 *
 * ★ WHY SO MANY QUERIES RUN AT ONCE ★
 *
 * A dashboard is a page of independent questions. Run in sequence they add up
 * to a visibly slow load; run together they cost about as much as the slowest
 * one. They are all indexed reads over a hundred members.
 */

export interface DashboardData {
  /** The month everything monthly is scoped to, as `YYYY-MM`. */
  readonly month: string;

  readonly discord: {
    readonly messages: number;
    readonly forumPosts: number;
    readonly voiceJoins: number;
    /** Members with at least one act of participation this month. */
    readonly activeMembers: number;
    /** Members the bot has ever seen, this month or not. */
    readonly trackedMembers: number;
    /** Message count per day of the month, index 0 = the 1st. */
    readonly daily: readonly number[];
    readonly top: ReadonlyArray<{ name: string; messages: number; voice: number }>;
  };

  readonly game: {
    /** Journal events ingested, all time. */
    readonly events: number;
    /** Commanders whose companion app has ever sent anything. */
    readonly reporting: number;
    /** Game sessions started this month. */
    readonly sessionsThisMonth: number;
    /** Distinct commanders seen flying this month. */
    readonly flyingThisMonth: number;
    /** Playing right now, by the journal heartbeat. */
    readonly playingNow: number;
    readonly ships: ReadonlyArray<{ ship: string; pilots: number }>;
    /** Events per category, so it is visible WHAT is being collected. */
    readonly byType: ReadonlyArray<{ type: string; count: number }>;
  };

  readonly squadron: {
    readonly members: number;
    readonly verified: number;
    /** Members holding each hierarchical rank, highest rung first. */
    readonly ranks: ReadonlyArray<{ rank: string; held: number }>;
    /** Meets both halves of the monthly test right now. */
    readonly qualifying: number;
  };
}

export interface DashboardStore {
  dashboard(now: Date): Promise<DashboardData>;
}

/** Playing-now window, matched to the roster card's so the two never disagree. */
const PLAYING_WINDOW_MS = 5 * 60_000;

export class PrismaDashboardStore implements DashboardStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async dashboard(now: Date): Promise<DashboardData> {
    // UTC throughout. A month boundary read in local time would move the whole
    // dashboard by a day depending on where the server happens to run.
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const monthKey = month.toISOString().slice(0, 7);

    const [
      activity,
      trackedMembers,
      daily,
      events,
      reporting,
      sessions,
      playingNow,
      ships,
      byType,
      members,
      verified,
      ranks,
    ] = await Promise.all([
      this.#db.memberActivityMonth.findMany({
        where: { month },
        select: {
          messageCount: true,
          forumPostCount: true,
          voiceJoinCount: true,
          gameActivity: true,
          discordId: true,
          user: { select: { displayName: true } },
        },
        orderBy: { messageCount: 'desc' },
      }),
      this.#db.memberActivityMonth.findMany({ distinct: ['discordId'], select: { discordId: true } }),

      /*
       * Messages per day.
       *
       * ★ THIS CANNOT COME FROM member_activity_months ★
       *
       * That table holds one row per member per MONTH — the day is not in it.
       * The shape of a month has to be read from the audit of activity times,
       * and the only per-event record we keep is the last-activity timestamp.
       * So this is a histogram of when members were LAST active each day,
       * which is a real signal (how many people showed up) and is labelled as
       * such rather than being passed off as a message count.
       */
      this.#db.$queryRaw<Array<{ day: number; n: bigint }>>`
        SELECT EXTRACT(DAY FROM last_activity_at)::int AS day, COUNT(*)::bigint AS n
        FROM member_activity_months
        WHERE month = ${month}::date AND last_activity_at IS NOT NULL
        GROUP BY 1 ORDER BY 1
      `,

      this.#db.telemetryEvent.count(),
      this.#db.telemetryEvent.findMany({ distinct: ['userId'], select: { userId: true } }),
      this.#db.telemetryEvent.findMany({
        where: { eventType: 'LoadGame', occurredAt: { gte: month, lt: nextMonth } },
        select: { userId: true },
      }),
      this.#db.user.count({
        where: { lastPlayingAt: { gte: new Date(now.getTime() - PLAYING_WINDOW_MS) } },
      }),

      /*
       * Ships in use, from the newest LoadGame per commander.
       *
       * DISTINCT ON rather than counting every LoadGame ever: otherwise the
       * member who plays most often decides the fleet composition single
       * handed, and a ship somebody sold two months ago still appears.
       */
      this.#db.$queryRaw<Array<{ ship: string; pilots: bigint }>>`
        SELECT ship, COUNT(*)::bigint AS pilots FROM (
          SELECT DISTINCT ON (user_id)
            user_id,
            COALESCE(payload->>'Ship_Localised', payload->>'Ship') AS ship
          FROM telemetry_events
          WHERE event_type = 'LoadGame'
          ORDER BY user_id, occurred_at DESC
        ) latest
        WHERE ship IS NOT NULL
        GROUP BY ship ORDER BY pilots DESC, ship ASC LIMIT 8
      `,

      this.#db.telemetryEvent.groupBy({
        by: ['eventType'],
        _count: { _all: true },
        orderBy: { _count: { eventType: 'desc' } },
      }),

      this.#db.user.count({ where: { status: 'active' } }),
      this.#db.cmdrVerification.count({ where: { isVerified: true, revokedAt: null } }),
      this.#db.userRole.groupBy({
        by: ['roleId'],
        _count: { _all: true },
      }),
    ]);

    // Rank names for the grouped counts. One extra small read rather than a
    // join multiplied across every grant.
    const roleRows = await this.#db.role.findMany({
      where: { isHierarchical: true },
      select: { id: true, name: true, rankOrder: true },
      orderBy: { rankOrder: 'desc' },
    });
    const heldByRole = new Map(ranks.map((r) => [r.roleId, r._count._all]));

    const daysInMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const dailyArray = Array.from({ length: daysInMonth }, () => 0);
    for (const row of daily) {
      // 1-indexed day to 0-indexed slot. Guarded because a clock-skewed row
      // would otherwise write past the end of the array.
      const slot = row.day - 1;
      if (slot >= 0 && slot < dailyArray.length) dailyArray[slot] = Number(row.n);
    }

    const sum = (pick: (r: (typeof activity)[number]) => number) =>
      activity.reduce((acc, r) => acc + pick(r), 0);

    return {
      month: monthKey,
      discord: {
        messages: sum((r) => r.messageCount),
        forumPosts: sum((r) => r.forumPostCount),
        voiceJoins: sum((r) => r.voiceJoinCount),
        activeMembers: activity.filter(
          (r) => r.messageCount > 0 || r.forumPostCount > 0 || r.voiceJoinCount > 0,
        ).length,
        trackedMembers: trackedMembers.length,
        daily: dailyArray,
        top: activity.slice(0, 8).map((r) => ({
          // Falls back to the snowflake for members who have never signed in.
          // Showing an id is honest; inventing "Unknown" hides that they exist.
          name: r.user?.displayName ?? `Discord ${r.discordId.slice(-4)}`,
          messages: r.messageCount,
          voice: r.voiceJoinCount,
        })),
      },
      game: {
        events,
        reporting: reporting.length,
        sessionsThisMonth: sessions.length,
        flyingThisMonth: new Set(sessions.map((s) => s.userId)).size,
        playingNow,
        ships: ships.map((s) => ({ ship: s.ship, pilots: Number(s.pilots) })),
        byType: byType.map((t) => ({ type: t.eventType, count: t._count._all })),
      },
      squadron: {
        members,
        verified,
        ranks: roleRows
          .map((r) => ({ rank: r.name, held: heldByRole.get(r.id) ?? 0 }))
          .filter((r) => r.held > 0),
        qualifying: activity.filter(
          (r) =>
            (r.messageCount > 0 || r.forumPostCount > 0 || r.voiceJoinCount > 0) &&
            (r.gameActivity === 'observed' || r.gameActivity === 'assumed'),
        ).length,
      },
    };
  }
}
