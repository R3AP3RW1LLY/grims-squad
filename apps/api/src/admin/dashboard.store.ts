import type { PrismaClient } from '@grims/db';
import { isSuit, shipDisplayName } from '@grims/shared';
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
  /**
   * How many days this month has — 28, 29, 30 or 31.
   *
   * Sent rather than computed on the client, so the axis length and the data come from the same
   * place. A client deriving it from `month` is a second implementation of leap years.
   */
  readonly daysInMonth: number;
  /** Months that actually have activity, newest first, as `YYYY-MM`. Drives the history tabs. */
  readonly availableMonths: readonly string[];

  readonly discord: {
    readonly messages: number;
    readonly forumPosts: number;
    readonly voiceJoins: number;
    /** Members with at least one act of participation this month. */
    readonly activeMembers: number;
    /** Members the bot has ever seen, this month or not. */
    readonly trackedMembers: number;
    /** Messages per day of the month, index 0 = the 1st. */
    readonly daily: readonly number[];
    /** Voice joins per day. Separate from messages — see the query. */
    readonly dailyVoice: readonly number[];
    /** Forum posts per day. */
    readonly dailyForum: readonly number[];
    /** Distinct members active on each day, index 0 = the 1st. */
    readonly dailyMembers: readonly number[];
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
    /**
     * Elite sign-ins per day of the month, index 0 = the 1st.
     *
     * ★ UNDER `game`, NOT `discord` ★
     *
     * It sits beside the Discord daily series on the same chart, which makes it
     * tempting to file it next to them. It is not a Discord fact: it comes from
     * `LoadGame` in the journal, and putting it under `discord` would be the
     * first step to somebody summing it into a Discord total.
     */
    readonly dailySignIns: readonly number[];
    /** Distinct commanders seen flying this month. */
    readonly flyingThisMonth: number;
    /** Playing right now, by the journal heartbeat. */
    readonly playingNow: number;
    readonly ships: ReadonlyArray<{ ship: string; pilots: number }>;
    /** What the squadron is WEARING. Same source, filtered the other way. */
    readonly suits: ReadonlyArray<{ suit: string; pilots: number }>;
    /**
     * How the squadron's wealth is spread, among those who opted in.
     *
     * EMPTY when too few people have opted in to be anonymous — see `MIN_CREDIT_COHORT`.
     */
    readonly creditBands: ReadonlyArray<{ band: string; pilots: number }>;
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
  /**
   * `selectedMonth` is `YYYY-MM`, or absent for the current month.
   *
   * Optional so every existing caller and test keeps working unchanged — the history tabs are an
   * addition, not a new requirement on anybody who just wants today's numbers.
   */
  dashboard(now: Date, selectedMonth?: string): Promise<DashboardData>;
}

/** Playing-now window, matched to the roster card's so the two never disagree. */
const PLAYING_WINDOW_MS = 5 * 60_000;

/**
 * `2026-06` -> the first of that month, UTC. Null for anything else.
 *
 * ★ VALIDATED, BECAUSE IT ARRIVES FROM A QUERY STRING ★
 *
 * It is interpolated into a date comparison, so a value that is not a month must never reach the
 * query. Null falls back to the current month rather than erroring — a bad tab in a URL should show
 * today, not a stack trace.
 */
function parseMonth(value: string | undefined): Date | null {
  if (value === undefined || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split('-').map(Number);
  if (year === undefined || month === undefined) return null;
  // Refuse anything absurd: a typo in a URL should not scan a table for the year 9999.
  if (year < 2020 || year > 2100) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

export class PrismaDashboardStore implements DashboardStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }


  async dashboard(now: Date, selectedMonth?: string): Promise<DashboardData> {
    // UTC throughout. A month boundary read in local time would move the whole
    // dashboard by a day depending on where the server happens to run.
    /*
     * ★ THE CALENDAR MONTH, WITH ITS OWN NUMBER OF DAYS — squadron owner, 2026-08-01 ★
     *
     * "not a 30 day window, as many days that are in the current month please!"
     *
     * Twenty-eight to thirty-one bars depending on the month, which is what a reader expects when
     * the axis is dates. A fixed thirty-day window spans two months and puts a boundary in the
     * middle of the chart with nothing marking it.
     *
     * ★ AND A MONTH CAN BE ASKED FOR ★
     *
     * "add tabs to the admin console for each month of the year so we can go back and look at
     * history please, do this for the member activiy & promotions too."
     *
     * That is also the answer to the thing that started this: at 00:04 on 1 August the console was
     * blank, because August genuinely had no data yet. It was not broken and nothing was lost —
     * 355 rows sat in July. The fix is not to widen the window until the emptiness is hidden; it is
     * to make July reachable, and to say plainly why a fresh month looks quiet.
     */
    const picked = parseMonth(selectedMonth);
    const month = picked ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
    const monthKey = month.toISOString().slice(0, 7);

    // Day 0 of the next month is the last day of this one — 28, 29, 30 or 31 without a lookup table.
    const daysInMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();

    const [
      activity,
      trackedMembers,
      guildMembers,
      monthsWithData,
      daily,
      dailySignIns,
      events,
      reporting,
      sessions,
      playingNow,
      ships,
      creditBands,
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
       * ★ REAL PER-DAY DATA, FROM ITS OWN TABLE ★
       *
       * This used to read `last_activity_at` off the MONTHLY rows, which counts
       * each member on the single day they were last seen — somebody active on
       * the 5th and the 20th appeared only on the 20th. A busy month rendered
       * as a scattering of single marks, which looked entirely plausible.
       *
       * Both figures come back in one pass: total messages (the intensity of a
       * day) and distinct members (how many people showed up). They answer
       * different questions and one loud member should not look like a crowd.
       */
      /*
       * ★ THREE SUMS, NOT ONE ★
       *
       * Squadron owner, 2026-07-30: "add another data set to the activity graph ... for forum
       * activity ... for discord activity in this chart, seperate message activity and voice
       * activity".
       *
       * This used to add all three columns together into a single "Actions" line, which answers
       * "was it busy" and nothing else. A quiet week of chat with a big voice night looked
       * identical to a steady week of typing — and the two call for completely different
       * reactions from whoever is reading the chart.
       *
       * Still ONE query. Three separate ones over the same rows for the same window would be
       * three scans to produce three columns the first scan already had.
       */
      /*
       * Which months have anything in them, for the history tabs.
       *
       * From the DAILY table rather than a generated range: offering a tab for a month with no rows
       * is offering a blank page, and the whole reason this exists is that a blank page is
       * alarming. Newest first, because that is the order somebody looks.
       */
      this.#db.$queryRaw<Array<{ m: string }>>`
        SELECT DISTINCT to_char(day, 'YYYY-MM') AS m
          FROM member_activity_days
         ORDER BY 1 DESC
         LIMIT 24
      `,
      this.#db.$queryRaw<
        Array<{ day: number; msgs: bigint; voice: bigint; forum: bigint; members: bigint }>
      >`
        SELECT
          EXTRACT(DAY FROM day)::int          AS day,
          SUM(message_count)::bigint          AS msgs,
          SUM(voice_join_count)::bigint       AS voice,
          SUM(forum_post_count)::bigint       AS forum,
          COUNT(DISTINCT discord_id)::bigint  AS members
        FROM member_activity_days
        WHERE day >= ${month}::date AND day < ${nextMonth}::date
        GROUP BY 1 ORDER BY 1
      `,

      /*
       * Elite sign-ins per day, for the activity chart's third line.
       *
       * ★ `LoadGame` IS THE SIGN-IN ★
       *
       * The journal writes it once when a commander loads into the game, so
       * counting the events IS counting the sign-ins. Squadron owner,
       * 2026-07-29.
       *
       * A separate query from the Discord one above rather than a join: the two
       * come from different tables with different grains — `member_activity_days`
       * is one row per member per day, `telemetry_events` is one row per event —
       * and joining them would multiply one by the other.
       *
       * Bounded to the month on screen for the same reason as everything else
       * here: a full scan of telemetry_events to draw thirty-one points would
       * grow with the archive rather than with the chart.
       */
      this.#db.$queryRaw<Array<{ day: number; signins: bigint }>>`
        SELECT
          EXTRACT(DAY FROM occurred_at AT TIME ZONE 'UTC')::int AS day,
          COUNT(*)::bigint                                      AS signins
        FROM telemetry_events
        WHERE event_type = 'LoadGame'
          AND occurred_at >= ${month}::date
          AND occurred_at <  ${nextMonth}::date
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
      /*
       * ★ THE RAW NAME, FROM Loadout, RESOLVED IN APPLICATION CODE ★
       *
       * This used to select `COALESCE(Ship_Localised, Ship)` from `LoadGame`, which was wrong
       * three ways and produced `$TacticalSuit_Class1_Name;` on the production dashboard:
       *
       *   - `LoadGame` fires once at login and reports whatever the member logged out IN, so an
       *     on-foot logout put a SUIT in the ships chart.
       *   - `Ship_Localised` is WRONG for upgraded suits — Frontier registered only the grade-1
       *     string, so Class 4 and Class 5 both localise to the Class 1 token.
       *   - `COALESCE` preferred that token precisely because it is not null.
       *
       * So the query now returns the RAW name and `shipDisplayName` decides what it is. Grouping
       * moves to application code for the same reason: two hulls can share a display name, and SQL
       * cannot know that without the mapping table living in it.
       */
      this.#db.$queryRaw<Array<{ ship: string; pilots: bigint }>>`
        SELECT ship, COUNT(*)::bigint AS pilots FROM (
          SELECT DISTINCT ON (user_id) user_id, payload->>'Ship' AS ship
          FROM telemetry_events
          WHERE event_type IN ('Loadout', 'LoadGame')
          ORDER BY user_id, occurred_at DESC
        ) latest
        WHERE ship IS NOT NULL
        GROUP BY ship ORDER BY pilots DESC, ship ASC
      `,

      /*
       * ★ CREDITS, BANDED AND OPT-IN ★
       *
       * Squadron owner, 2026-07-30: a chart for "org wide credit balances or something where people
       * allow people to view their balance, anonomyze the data".
       *
       * Three things make that safe rather than merely anonymous-looking:
       *
       *   - `show_credits` is an EXISTING opt-in that defaults to false. Nobody appears here who
       *     has not switched it on, so this is not a new disclosure wearing a chart.
       *   - Only a COUNT per band leaves the database. No names, no user ids, no figures — the
       *     query cannot return an individual balance because it never selects one.
       *   - Bands are wide and fixed. Quantiles would move with the population, so a member could
       *     watch a boundary shift and learn something about a specific person.
       *
       * The minimum-cohort rule is applied in application code below, because "too few people to
       * be anonymous" is a decision about disclosure rather than about SQL.
       */
      this.#db.$queryRaw<Array<{ band: string; pilots: bigint }>>`
        SELECT band, COUNT(*)::bigint AS pilots FROM (
          SELECT DISTINCT ON (t.user_id)
            t.user_id,
            CASE
              WHEN (t.payload->>'Credits')::bigint <          10000000 THEN 'Under 10M'
              WHEN (t.payload->>'Credits')::bigint <         100000000 THEN '10M – 100M'
              WHEN (t.payload->>'Credits')::bigint <        1000000000 THEN '100M – 1bn'
              WHEN (t.payload->>'Credits')::bigint <       10000000000 THEN '1bn – 10bn'
              ELSE '10bn+'
            END AS band
          FROM telemetry_events t
          JOIN privacy_settings p ON p.user_id = t.user_id AND p.show_credits = true
          WHERE t.event_type = 'LoadGame' AND t.payload->>'Credits' IS NOT NULL
          ORDER BY t.user_id, t.occurred_at DESC
        ) latest
        GROUP BY band
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
        } else if (appointment === null || mapped.rankOrder < appointment.rankOrder) {
          /*
       * ★ FOR APPOINTMENTS, THE LOWEST NUMBER IS THE MOST SENIOR ★
       *
       * The two ladders run in OPPOSITE directions and this is the trap. Tenure
       * ascends — Cadet 100 up to Grand Master General 190 — while appointments
       * descend: Squadron Leader 60, Sector Overseer 50, First Commander 40,
       * Chief Fleet Commander 30, Prime Legate 20, Galactic Admiral 10.
       *
       * Every officer also holds Squadron Leader as their base, so taking the
       * highest number reported the BASE rank for all nine of them. The
       * Galactic Admiral and the Prime Legate both showed as Squadron Leader,
       * which is precisely backwards.
       */
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

    // Computed once above, from the SELECTED month. Recomputing it from `now` here is what made
    // a chosen month draw the CURRENT month's number of bars — 31 slots for a 30-day June.
    const dailyArray = Array.from({ length: daysInMonth }, () => 0);
    /*
     * Zero-filled like the rest. A day with no voice activity produces no ROW, and a line that
     * skipped those days would draw straight through a quiet weekend as though it had been busy.
     */
    const dailyVoice = Array.from({ length: daysInMonth }, () => 0);
    const dailyForum = Array.from({ length: daysInMonth }, () => 0);
    const dailyMembers = Array.from({ length: daysInMonth }, () => 0);
    /*
     * Elite sign-ins, filled from its own query.
     *
     * Zero-filled first, like the other two: a day nobody signed in produces no
     * ROW, and a chart that skipped those days would draw a straight line
     * through a quiet weekend as though it had been busy.
     */
    const dailySignInsArray = Array.from({ length: daysInMonth }, () => 0);
    for (const row of dailySignIns) {
      const slot = row.day - 1;
      if (slot < 0 || slot >= dailySignInsArray.length) continue;
      dailySignInsArray[slot] = Number(row.signins);
    }
    for (const row of daily) {
      // 1-indexed day to 0-indexed slot. Guarded because a clock-skewed row
      // would otherwise write past the end of the array.
      const slot = row.day - 1;
      if (slot < 0 || slot >= dailyArray.length) continue;
      dailyArray[slot] = Number(row.msgs);
      dailyVoice[slot] = Number(row.voice);
      dailyForum[slot] = Number(row.forum);
      dailyMembers[slot] = Number(row.members);
    }

    const byDiscordId = new Map(guildMembers.map((m) => [m.discordId, m]));

    const sum = (pick: (r: (typeof activity)[number]) => number) =>
      activity.reduce((acc, r) => acc + pick(r), 0);

    return {
      month: monthKey,
      daysInMonth,
      availableMonths: monthsWithData.map((r) => r.m),
      discord: {
        messages: sum((r) => r.messageCount),
        forumPosts: sum((r) => r.forumPostCount),
        voiceJoins: sum((r) => r.voiceJoinCount),
        activeMembers: activity.filter(
          (r) => r.messageCount > 0 || r.forumPostCount > 0 || r.voiceJoinCount > 0,
        ).length,
        trackedMembers: trackedMembers.length,
        daily: dailyArray,
        dailyVoice,
        dailyForum,
        dailyMembers,
        top: activity.slice(0, 10).map((r) => {
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
        dailySignIns: dailySignInsArray,
        flyingThisMonth: new Set(sessions.map((s) => s.userId)).size,
        playingNow,
        /*
         * ★ ONE QUERY, TWO CHARTS, RESOLVED HERE ★
         *
         * The rows carry RAW internal names; `shipDisplayName` decides what each one is and
         * whether it belongs in this chart at all. Grouping happens after resolution because two
         * internal names can share a display name, and a null means "not a ship" — a suit, or a
         * hull nobody has mapped — which is dropped rather than shown as an identifier.
         */
        ships: rollUp(ships, (raw) => shipDisplayName(raw)).map((r) => ({
          ship: r.name,
          pilots: r.pilots,
        })),
        suits: rollUp(ships, (raw) =>
          isSuit(raw) ? shipDisplayName(raw, null, { allowSuits: true }) : null,
        ).map((r) => ({ suit: r.name, pilots: r.pilots })),
        creditBands: bandedCredits(creditBands),
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
        // Ascending, so the most senior office comes FIRST — rank 10 is the
        // Galactic Admiral. The reverse of the tenure ladder's ordering, for
        // the same reason the picker above runs the other way.
        appointments: [...heldByAppointment.entries()]
          .map(([rank, held]) => ({ rank, held }))
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

/**
 * Groups raw journal names by their resolved display name.
 *
 * ★ RESOLVE THEN GROUP, NOT THE OTHER WAY ROUND ★
 *
 * Two internal names can resolve to the same thing, and SQL cannot know that without the mapping
 * table living in the database. Grouping in SQL therefore split one ship across two slices.
 *
 * A null resolution means "not for this chart" — a suit in the ships list, or a hull nobody has
 * mapped — and is dropped. Showing `panthermkii` to a member is worse than showing nothing, and
 * showing `$TacticalSuit_Class1_Name;` is how this was noticed.
 */
function rollUp(
  rows: ReadonlyArray<{ ship: string; pilots: bigint }>,
  resolve: (raw: string) => string | null,
): Array<{ name: string; pilots: number }> {
  const byName = new Map<string, number>();

  for (const row of rows) {
    const name = resolve(row.ship);
    if (name === null) continue;
    byName.set(name, (byName.get(name) ?? 0) + Number(row.pilots));
  }

  return [...byName.entries()]
    .map(([name, pilots]) => ({ name, pilots }))
    .sort((a, b) => b.pilots - a.pilots || a.name.localeCompare(b.name))
    .slice(0, 10);
}

/**
 * The fewest opted-in members before a wealth distribution may be shown at all.
 *
 * ★ WHY A FLOOR EXISTS ★
 *
 * Banding hides an exact figure; it does not hide a person. With two members opted in, a chart
 * reading "one in 100M – 1bn, one in 10bn+" tells anybody who knows which two they are exactly
 * what each is worth — and it does so while looking anonymised, which is worse than showing
 * nothing, because it invites trust it has not earned.
 *
 * Five is the point at which a band holding one person is no longer a statement about that person.
 */
export const MIN_CREDIT_COHORT = 5;

/** Bands in a fixed order, or nothing at all when the cohort is too small to be anonymous. */
function bandedCredits(
  rows: ReadonlyArray<{ band: string; pilots: bigint }>,
): Array<{ band: string; pilots: number }> {
  const total = rows.reduce((acc, r) => acc + Number(r.pilots), 0);
  if (total < MIN_CREDIT_COHORT) return [];

  /*
   * Fixed order, poorest first, and bands with nobody in them are DROPPED rather than shown as
   * zero. An empty band is itself a statement — "nobody here is under ten million" — and on a
   * chart about money that is the kind of thing people read into.
   */
  const ORDER = ['Under 10M', '10M – 100M', '100M – 1bn', '1bn – 10bn', '10bn+'];

  return ORDER.map((band) => ({
    band,
    pilots: Number(rows.find((r) => r.band === band)?.pilots ?? 0),
  })).filter((b) => b.pilots > 0);
}
