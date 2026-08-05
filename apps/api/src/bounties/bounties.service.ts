import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
// The key the WORKER writes when it rebuilds the board. Imported rather than spelled again here,
// so a rename cannot leave the reader silently looking up a row that no longer exists.
import { BOUNTY_ANCHOR_COUNT_KEY } from '@grims/shared';

/**
 * Reads for the Data Bounty board and the Data Runner leaderboard.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "create a new page under squadrons called Data bounty's ... turn this into our first offical
 * Data Runner Leaderboard please! gamify this too" — staleness-weighted points with jackpots,
 * automatic credit on companion upload, monthly seasons plus all-time, squadron space first.
 *
 * Everything here reads what other parts of the system maintain: the worker rebuilds the board
 * every half hour, the telemetry upload path pays claims. This service only presents — which is
 * why every method is a couple of plain queries and none of them touches the market table itself.
 */

export interface BountyRow {
  readonly stationKey: string;
  readonly stationName: string;
  readonly systemName: string;
  readonly stationType: string | null;
  readonly largePads: number | null;
  readonly lastSeenAt: Date | null;
  readonly daysStale: number | null;
  readonly points: number;
  readonly jackpot: boolean;
  readonly distanceLy: number | null;
}

export interface LeaderboardEntry {
  readonly handle: string;
  readonly displayName: string;
  readonly points: number;
  readonly claims: number;
  readonly jackpots: number;
}

export interface RunnerTotals {
  readonly monthPoints: number;
  readonly monthClaims: number;
  readonly allTimePoints: number;
  readonly allTimeClaims: number;
}

/** `2026-08` exactly. Anything else is refused, not guessed at. */
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class BountiesService {
  constructor(private readonly db: PrismaClient) {}

  /** The board, squadron space first — the order the owner asked the page to read in. */
  async board(): Promise<{
    computedAt: Date | null;
    ops: BountyRow[];
    galaxy: BountyRow[];
    activeProjects: number;
  }> {
    const rows = await this.db.$queryRawUnsafe<
      Array<{
        station_key: string;
        station_name: string;
        system_name: string;
        station_type: string | null;
        large_pads: number | null;
        last_seen_at: Date | null;
        days_stale: number | null;
        points: number;
        jackpot: boolean;
        in_ops: boolean;
        distance_ly: number | null;
        computed_at: Date;
      }>
    >(
      `SELECT station_key, station_name, system_name, station_type, large_pads,
              last_seen_at, days_stale, points, jackpot, in_ops, distance_ly, computed_at
         FROM data_bounties
        ORDER BY in_ops DESC, points DESC, station_key`,
    );

    const shape = (r: (typeof rows)[number]): BountyRow => ({
      stationKey: r.station_key,
      stationName: r.station_name,
      systemName: r.system_name,
      stationType: r.station_type,
      largePads: r.large_pads,
      lastSeenAt: r.last_seen_at,
      daysStale: r.days_stale,
      points: r.points,
      jackpot: r.jackpot,
      distanceLy: r.distance_ly,
    });

    /*
     * ★ AN EMPTY OPS LIST MEANS TWO COMPLETELY DIFFERENT THINGS ★
     *
     * Squadron space is everywhere within 200 ly of an ACTIVE colonisation project. With no active
     * project there is no anchor, so the section is empty because it is undefined — not because
     * everything near us is fresh.
     *
     * The page could not tell those apart and said "squadron space is lit" for both, which is a
     * claim that all our nearby data is current. Reported by the squadron owner on 2026-08-05:
     * the section was blank in production, and the copy read as though that were good news.
     *
     * ★ READ FROM WHAT THE BOARD RECORDED, NOT FROM colony_projects ★
     *
     * The obvious version counts active projects here. It is wrong twice. `ColonyProject` carries
     * an ACL and this endpoint is public, so counting it through the plain client is exactly what
     * INV-002 forbids — and the honest figure is not "how many projects exist right now" but "how
     * many this board was built from". The rebuild runs every half hour; a project started two
     * minutes ago is a real third state, and quoting live data against a stale board would explain
     * an empty section with a number that contradicts it.
     *
     * So the worker writes the anchor count when it builds, and this reads that. `site_config`
     * carries no ACL and is the same place the EDSY refresh keeps its version.
     */
    const recorded = await this.db.siteConfig.findUnique({
      where: { key: BOUNTY_ANCHOR_COUNT_KEY },
      select: { value: true },
    });
    const parsed = Number(recorded?.value ?? '');
    // A board that has never been built reports zero anchors, which is true: there is no squadron
    // space until something defines one.
    const activeProjects = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

    return {
      computedAt: rows[0]?.computed_at ?? null,
      ops: rows.filter((r) => r.in_ops).map(shape),
      galaxy: rows.filter((r) => !r.in_ops).map(shape),
      activeProjects,
    };
  }

  /**
   * One month's standings plus the all-time table.
   *
   * Seasons are calendar months IN UTC — the one clock every member's journal shares. A month key
   * that does not parse is an error to the caller, not a silent fallback to "this month": a wrong
   * leaderboard that looks right is the worst of the options.
   */
  async leaderboard(monthKey: string): Promise<{
    month: string;
    season: LeaderboardEntry[];
    allTime: LeaderboardEntry[];
  } | null> {
    if (!MONTH_KEY.test(monthKey)) return null;

    const entries = async (where: string, params: unknown[]): Promise<LeaderboardEntry[]> => {
      const rows = await this.db.$queryRawUnsafe<
        Array<{
          handle: string;
          display_name: string;
          points: number;
          claims: number;
          jackpots: number;
        }>
      >(
        `SELECT u.handle, u.display_name,
                sum(c.points)::int AS points,
                count(*)::int AS claims,
                count(*) FILTER (WHERE c.jackpot)::int AS jackpots
           FROM bounty_claims c
           JOIN users u ON u.id = c.user_id
           /*
            * The same participation rule as /leaderboards/bounties, or the two pages disagree:
            * a member who switched off the Data Runners board was vanishing there and still
            * standing here. COALESCE makes a missing privacy row mean "participating", exactly
            * as the schema defaults do; opted-out members are filtered, not blanked, and
            * everybody below them moves up.
            */
           LEFT JOIN privacy_settings ps ON ps.user_id = u.id
          ${where}
          ${where === '' ? 'WHERE' : 'AND'} COALESCE(ps.show_on_leaderboard, true)
            AND COALESCE(ps.show_lb_bounties, true)
          GROUP BY u.handle, u.display_name
          ORDER BY points DESC, claims DESC, u.handle
          LIMIT 50`,
        ...params,
      );
      return rows.map((r) => ({
        handle: r.handle,
        displayName: r.display_name,
        points: r.points,
        claims: r.claims,
        jackpots: r.jackpots,
      }));
    };

    const [season, allTime] = await Promise.all([
      entries(
        `WHERE date_trunc('month', c.claimed_at AT TIME ZONE 'UTC') = to_date($1, 'YYYY-MM')`,
        [monthKey],
      ),
      entries('', []),
    ]);

    return { month: monthKey, season, allTime };
  }

  /** The signed-in member's own numbers, for the "you" strip on the page. */
  async totals(userId: string): Promise<RunnerTotals> {
    const [row] = await this.db.$queryRawUnsafe<
      Array<{ mp: number; mc: number; ap: number; ac: number }>
    >(
      `SELECT
         COALESCE(sum(points) FILTER (WHERE date_trunc('month', claimed_at AT TIME ZONE 'UTC')
                                        = date_trunc('month', now() AT TIME ZONE 'UTC')), 0)::int AS mp,
         COALESCE(count(*)   FILTER (WHERE date_trunc('month', claimed_at AT TIME ZONE 'UTC')
                                        = date_trunc('month', now() AT TIME ZONE 'UTC')), 0)::int AS mc,
         COALESCE(sum(points), 0)::int AS ap,
         count(*)::int AS ac
       FROM bounty_claims
       WHERE user_id = $1::uuid`,
      userId,
    );
    return {
      monthPoints: row?.mp ?? 0,
      monthClaims: row?.mc ?? 0,
      allTimePoints: row?.ap ?? 0,
      allTimeClaims: row?.ac ?? 0,
    };
  }
}
