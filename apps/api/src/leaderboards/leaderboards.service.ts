import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import {
  LEADERBOARDS,
  badgeDisplay,
  showcase,
  type LeaderboardKey,
} from '@grims/shared';

/**
 * Reads for the gamified leaderboards and the badges earned on them.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "make a new category called leaderboards ... gamify the colonization leaderboard, make badges
 * ect the same way were doing it for databounties ... then we also need to make a leaderboard and
 * gamify it for Trade routes make this work like the other ones too ... default all leaderboard
 * participation on for all commanders"
 *
 * ★ THREE BOARDS, TWO LEDGERS ★
 *
 * Data Runners keeps its own richer ledger in `bounty_claims` (jackpots, station keys) and the
 * worker's scorers write colony and trade deeds to `leaderboard_events`. This service presents
 * both through ONE shape, so the page renders three boards without knowing which table fed each —
 * the same reason the tier thresholds are identical across boards.
 *
 * Everything here reads what other parts of the system maintain: the telemetry upload path pays
 * bounty claims, the worker's scorers write events and award badges. Presentation only.
 */

export interface LeaderboardEntryView {
  readonly handle: string;
  readonly displayName: string;
  readonly points: number;
  /** How many scoring deeds, whatever the board calls one — claims, deliveries, sales. */
  readonly claims: number;
}

export interface MyStanding {
  readonly seasonPoints: number;
  readonly lifetimePoints: number;
  /**
   * Where the caller sits on the SEASON table as members see it — counted against participants
   * only, so the number agrees with the rows on the page. Null until they have scored this
   * season: "you are ranked 41st with nothing" is not a sentence worth sending.
   */
  readonly seasonRank: number | null;
}

export interface BoardStandings {
  readonly key: LeaderboardKey;
  readonly name: string;
  readonly measures: string;
  readonly season: readonly LeaderboardEntryView[];
  readonly allTime: readonly LeaderboardEntryView[];
  /** The caller's own numbers. Null for a guest — there is nobody to count. */
  readonly me: MyStanding | null;
}

export interface StandingsView {
  readonly month: string;
  readonly boards: readonly BoardStandings[];
}

/** One badge as a page renders it, resolved through the shared catalogue. */
export interface BadgeView {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly earnedAt: string;
}

/** `2026-08` exactly. Anything else is refused, not guessed at — same rule as the bounty board. */
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Where each board's points live, and which switch opts a member out of it.
 *
 * ★ EVERY VALUE HERE IS A CODE LITERAL, NEVER REQUEST INPUT ★
 *
 * These fragments are interpolated into SQL, which is only safe because the record is closed and
 * the key arrives from the LEADERBOARDS catalogue rather than from a query string. The month key
 * — the one value a caller controls — always travels as a bind parameter.
 */
const SOURCES: Record<
  LeaderboardKey,
  { table: string; timeColumn: string; boardFilter: string; optColumn: string }
> = {
  bounties: {
    table: 'bounty_claims',
    timeColumn: 'claimed_at',
    boardFilter: '',
    optColumn: 'show_lb_bounties',
  },
  colony: {
    table: 'leaderboard_events',
    timeColumn: 'occurred_at',
    boardFilter: `AND s.board = 'colony'`,
    optColumn: 'show_lb_colony',
  },
  trade: {
    table: 'leaderboard_events',
    timeColumn: 'occurred_at',
    boardFilter: `AND s.board = 'trade'`,
    optColumn: 'show_lb_trade',
  },
};

/**
 * The participation test, shared by every list below.
 *
 * ★ AN ABSENT ROW PARTICIPATES — OWNER'S EXPLICIT INSTRUCTION ★
 *
 * "default all leaderboard participation on for all commanders". The privacy row is created
 * lazily, so most members have none; the schema defaults every leaderboard switch to TRUE, and
 * COALESCE is what makes a missing row mean the same thing as an untouched one. The master
 * switch (`show_on_leaderboard`) still turns everything off at once; the per-board column
 * narrows it board by board.
 */
function participates(optColumn: string): string {
  return `COALESCE(ps.show_on_leaderboard, true) AND COALESCE(ps.${optColumn}, true)`;
}

@Injectable()
export class LeaderboardsService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * All three boards for one month, plus the all-time tables, plus the caller's own standing.
   *
   * Seasons are calendar months IN UTC — the one clock every member's journal shares. A month
   * key that does not parse is null to the controller, not a silent fallback: a wrong
   * leaderboard that looks right is the worst of the options.
   */
  async standings(monthKey: string, callerId: string | null): Promise<StandingsView | null> {
    if (!MONTH_KEY.test(monthKey)) return null;

    const boards = await Promise.all(
      LEADERBOARDS.map(async (def) => {
        const [season, allTime, me] = await Promise.all([
          this.#entries(def.key, monthKey),
          this.#entries(def.key, null),
          callerId === null ? Promise.resolve(null) : this.#mine(def.key, callerId, monthKey),
        ]);
        return {
          key: def.key,
          name: def.name,
          measures: def.measures,
          season,
          allTime,
          me,
        };
      }),
    );

    return { month: monthKey, boards };
  }

  /**
   * One board's table — the month named, or all time when `monthKey` is null.
   *
   * ★ OPTED-OUT MEMBERS ARE ABSENT, NOT ANONYMISED ★
   *
   * A blanked row would still disclose that somebody with N points exists and is hiding, and it
   * would hold a rank on a table it asked to leave. Filtered in the WHERE clause, so a member who
   * opts out simply is not part of the standings — and everybody below them moves up.
   */
  async #entries(
    board: LeaderboardKey,
    monthKey: string | null,
  ): Promise<LeaderboardEntryView[]> {
    const src = SOURCES[board];
    const monthFilter =
      monthKey === null
        ? ''
        : `AND date_trunc('month', s.${src.timeColumn} AT TIME ZONE 'UTC') = to_date($1, 'YYYY-MM')`;

    const rows = await this.db.$queryRawUnsafe<
      Array<{ handle: string; display_name: string; points: number; claims: number }>
    >(
      `SELECT u.handle, u.display_name,
              sum(s.points)::int AS points,
              count(*)::int AS claims
         FROM ${src.table} s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN privacy_settings ps ON ps.user_id = s.user_id
        WHERE ${participates(src.optColumn)}
          ${src.boardFilter}
          ${monthFilter}
        GROUP BY u.handle, u.display_name
        ORDER BY points DESC, claims DESC, u.handle
        LIMIT 50`,
      ...(monthKey === null ? [] : [monthKey]),
    );

    return rows.map((r) => ({
      handle: r.handle,
      displayName: r.display_name,
      points: r.points,
      claims: r.claims,
    }));
  }

  /**
   * The caller's own numbers on one board.
   *
   * ★ COMPUTED WHETHER OR NOT THEY APPEAR ON THE TABLE ★
   *
   * Opting out hides a member from everybody else; it does not hide their own score from them.
   * So the points sums here carry no privacy filter at all. The RANK is counted against
   * participants only — it answers "where do I sit on the table the squadron sees", and for a
   * member who opted out, "where would I sit".
   */
  async #mine(
    board: LeaderboardKey,
    userId: string,
    monthKey: string,
  ): Promise<MyStanding> {
    const src = SOURCES[board];
    // `s` aliases both the caller's own rows and the field's, so boardFilter serves both scans.
    const [row] = await this.db.$queryRawUnsafe<
      Array<{ season: number; lifetime: number; ahead: number }>
    >(
      `WITH mine AS (
         SELECT COALESCE(sum(s.points) FILTER (
                  WHERE date_trunc('month', s.${src.timeColumn} AT TIME ZONE 'UTC') = to_date($2, 'YYYY-MM')
                ), 0)::int AS season,
                COALESCE(sum(s.points), 0)::int AS lifetime
           FROM ${src.table} s
          WHERE s.user_id = $1::uuid ${src.boardFilter}
       ),
       standing AS (
         SELECT count(*)::int AS ahead
           FROM (SELECT s.user_id, sum(s.points) AS pts
                   FROM ${src.table} s
                   LEFT JOIN privacy_settings ps ON ps.user_id = s.user_id
                  WHERE s.user_id <> $1::uuid
                    AND ${participates(src.optColumn)}
                    ${src.boardFilter}
                    AND date_trunc('month', s.${src.timeColumn} AT TIME ZONE 'UTC') = to_date($2, 'YYYY-MM')
                  GROUP BY s.user_id) o
          WHERE o.pts > (SELECT season FROM mine)
       )
       SELECT mine.season, mine.lifetime, standing.ahead FROM mine, standing`,
      userId,
      monthKey,
    );

    const seasonPoints = row?.season ?? 0;
    return {
      seasonPoints,
      lifetimePoints: row?.lifetime ?? 0,
      seasonRank: seasonPoints === 0 ? null : (row?.ahead ?? 0) + 1,
    };
  }

  /**
   * Every badge one member has earned, resolved to something a page can draw.
   *
   * A key the catalogue no longer knows is SKIPPED rather than rendered as a hole — a retired
   * badge strands nobody, but it also earns no blank chip. Newest first, because the badge a
   * member opens the page to look at is the one they just earned.
   */
  async badgesOf(userId: string): Promise<BadgeView[]> {
    const rows = await this.db.memberBadge.findMany({
      where: { userId },
      select: { badgeKey: true, earnedAt: true },
      orderBy: { earnedAt: 'desc' },
    });

    const out: BadgeView[] = [];
    for (const r of rows) {
      const display = badgeDisplay(r.badgeKey);
      if (display === null) continue;
      out.push({
        key: display.key,
        name: display.name,
        description: display.description,
        icon: display.icon,
        earnedAt: r.earnedAt.toISOString(),
      });
    }
    return out;
  }

  /**
   * The few badges worth showing beside each of these members' names where space is tight.
   *
   * ★ CAPPED SERVER-SIDE, SO THE WIRE CARRIES THE CAP ★
   *
   * `showcase` ranks a member's badges rarest-first and truncates. Doing that here rather than
   * in the client means a thread response carries at most `limit` keys per author however many
   * badges they hold — and every surface truncates identically, because none of them truncates.
   *
   * ONE query for the whole author list, keyed on ids the caller already deduplicated. Members
   * with no badges are simply absent from the map, which serialises to no key at all.
   */
  async showcaseFor(userIds: readonly string[], limit: number): Promise<Map<string, string[]>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.db.memberBadge.findMany({
      where: { userId: { in: [...userIds] } },
      select: { userId: true, badgeKey: true },
    });

    const keysByUser = new Map<string, string[]>();
    for (const r of rows) {
      const held = keysByUser.get(r.userId);
      if (held === undefined) keysByUser.set(r.userId, [r.badgeKey]);
      else held.push(r.badgeKey);
    }

    const out = new Map<string, string[]>();
    for (const [userId, keys] of keysByUser) {
      const picked = showcase(keys, limit).map((b) => b.key);
      if (picked.length > 0) out.set(userId, picked);
    }
    return out;
  }
}
