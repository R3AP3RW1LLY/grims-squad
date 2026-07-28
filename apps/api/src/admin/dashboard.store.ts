import type { PrismaClient } from '@grims/db';
import { LEADERSHIP_CEILING } from '../members/members.store.js';

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
    readonly top: ReadonlyArray<{
      name: string;
      messages: number;
      voice: number;
      /** Their verified commander name, when they have one. */
      cmdrName: string | null;
    }>;
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
    /** Members of the GUILD. Not website accounts — see the note on the query. */
    readonly members: number;
    /** Of those, how many have an account here. */
    readonly withAccounts: number;
    readonly verified: number;
    /** Members at each TENURE rank, highest rung first. Appointments are separate. */
    readonly ranks: ReadonlyArray<{ rank: string; held: number }>;
    /** Leadership appointments, which are not on the promotion ladder at all. */
    readonly appointments: ReadonlyArray<{ rank: string; held: number }>;
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
      guildMembers,
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
          user: {
            select: {
              displayName: true,
              /*
               * The verified commander name, so the leaderboard can show who
               * somebody is IN GAME as well as in Discord. Read live rather
               * than cached, so a verification completed a minute ago shows on
               * the next load without waiting for anything.
               */
              cmdrVerifications: {
                where: { isVerified: true, revokedAt: null },
                select: { cmdrName: true },
                orderBy: { verifiedAt: 'desc' as const },
                take: 1,
              },
            },
          },
        },
        orderBy: { messageCount: 'desc' },
      }),
      this.#db.memberActivityMonth.findMany({ distinct: ['discordId'], select: { discordId: true } }),

      /*
       * ★ NAMES FOR EVERY MEMBER, NOT JUST THE ONES WITH ACCOUNTS ★
       *
       * The leaderboard used to fall back to the last four digits of a
       * snowflake for anybody who had not signed in — fifty of fifty-one
       * members — which made "most active" a list of numbers and useless for
       * the one thing it exists to do.
       *
       * Same cache the activity tab reads, so the two can never disagree about
       * what somebody is called. The bot keeps it current on every
       * GuildMemberUpdate, so a nickname changed in Discord is right here on
       * the next load.
       */
      this.#db.discordGuildMember.findMany({
        select: {
          discordId: true,
          nick: true,
          username: true,
          globalName: true,
          /*
           * Roles too, because the ladder panel is built from them. Reading
           * granted UserRole rows produced an EMPTY ladder against real data:
           * the only grant in the database is Webmaster, which is not
           * hierarchical, while fifty members wear mapped rank roles in
           * Discord. Grants appear after reconciliation for an account that
           * exists, and most of the squadron has neither.
           */
          roles: true,
          isBot: true,
        },
      }),

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
      /*
       * The mapping from Discord role to internal rank. Small, and read once
       * for the whole page rather than joined per member.
       */
      this.#db.roleMapping.findMany({
        where: { role: { isHierarchical: true } },
        select: { discordRoleId: true, role: { select: { name: true, rankOrder: true } } },
      }),
    ]);

    /*
     * ★ ONE MEMBER COUNTS ONCE, AT THEIR HIGHEST RANK ★
     *
     * A member can wear several mapped roles — mid-promotion, or because an old
     * one was never removed. Counting each role separately would make the
     * ladder add up to more than the squadron, and the distribution would look
     * top-heavy for a reason nobody could see.
     *
     * Bots are excluded: they hold roles and are not members.
     */
    const rankByRoleId = new Map(ranks.map((m) => [m.discordRoleId, m.role]));
    const heldByRank = new Map<string, number>();
    const heldByAppointment = new Map<string, number>();
    const rankOrderOf = new Map<string, number>();

    for (const m of guildMembers) {
      if (m.isBot) continue;

      /*
       * ★ TENURE AND APPOINTMENTS ARE DIFFERENT LADDERS ★
       *
       * Roles below LEADERSHIP_CEILING are appointments; from it upward they
       * are tenure ranks earned by qualifying months. Counting them in one list
       * put "Squadron Leader" at the bottom of a ladder it is not on — the same
       * error already corrected on the activity tab, and leaving the two
       * disagreeing would be worse than either.
       */
      let tenure: { name: string; rankOrder: number } | null = null;
      let appointment: { name: string; rankOrder: number } | null = null;

      for (const roleId of m.roles) {
        const mapped = rankByRoleId.get(roleId);
        if (mapped === undefined) continue;

        if (mapped.rankOrder >= LEADERSHIP_CEILING) {
          if (tenure === null || mapped.rankOrder > tenure.rankOrder) tenure = mapped;
        } else if (appointment === null || mapped.rankOrder > appointment.rankOrder) {
          appointment = mapped;
        }
      }

      if (tenure !== null) {
        heldByRank.set(tenure.name, (heldByRank.get(tenure.name) ?? 0) + 1);
        rankOrderOf.set(tenure.name, tenure.rankOrder);
      }
      if (appointment !== null) {
        heldByAppointment.set(appointment.name, (heldByAppointment.get(appointment.name) ?? 0) + 1);
        rankOrderOf.set(appointment.name, appointment.rankOrder);
      }
    }

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

    const byDiscordId = new Map(guildMembers.map((m) => [m.discordId, m]));

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
        top: activity.slice(0, 8).map((r) => {
          const guild = byDiscordId.get(r.discordId);
          return {
            /*
             * Nickname first — by this squadron's convention that IS the
             * commander name, and it is what officers recognise each other by.
             * Then Discord's global display name, then the handle.
             *
             * The snowflake remains the last resort rather than "Unknown":
             * showing an id is honest about a member we cannot name, whereas a
             * placeholder hides that they exist at all.
             */
            name:
              guild?.nick ??
              guild?.globalName ??
              guild?.username ??
              r.user?.displayName ??
              `Discord ${r.discordId.slice(-4)}`,
            messages: r.messageCount,
            voice: r.voiceJoinCount,
            cmdrName: r.user?.cmdrVerifications[0]?.cmdrName ?? null,
          };
        }),
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
        /*
         * ★ GUILD MEMBERS, NOT WEBSITE ACCOUNTS ★
         *
         * This was `users where status = active`, which is ONE. The dashboard
         * then divided fifty-one active members by it and reported five
         * thousand per cent participation.
         *
         * The squadron is the guild. Having an account here is a separate fact,
         * and it is reported as one.
         */
        members: guildMembers.filter((m) => !m.isBot).length,
        withAccounts: members,
        verified,
        // Highest rung first, so the ladder reads top-down the way it is climbed.
        ranks: [...heldByRank.entries()]
          .map(([rank, held]) => ({ rank, held }))
          .sort((a, b) => (rankOrderOf.get(b.rank) ?? 0) - (rankOrderOf.get(a.rank) ?? 0)),
        appointments: [...heldByAppointment.entries()]
          .map(([rank, held]) => ({ rank, held }))
          // Ascending: rank 10 (Galactic Admiral) is the MOST senior appointment,
          // which is the reverse of the tenure ladder's ordering.
          .sort((a, b) => (rankOrderOf.get(a.rank) ?? 0) - (rankOrderOf.get(b.rank) ?? 0)),
        qualifying: activity.filter(
          (r) =>
            (r.messageCount > 0 || r.forumPostCount > 0 || r.voiceJoinCount > 0) &&
            (r.gameActivity === 'observed' || r.gameActivity === 'assumed'),
        ).length,
      },
    };
  }
}
