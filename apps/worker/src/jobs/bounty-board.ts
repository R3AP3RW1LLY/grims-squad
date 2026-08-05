import type { PrismaClient } from '@grims/db';

/**
 * Rebuilding the Data Bounty board.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "create a list of all stations and systems we need to dock at to shore up market data etc that is
 * unknown or stale! any time something goes stale it should automatically be added to the list" —
 * with staleness-weighted points, jackpots, and squadron space ranked above the galaxy tail.
 *
 * ★ A SNAPSHOT REBUILT ON A TIMER, NOT A QUEUE MAINTAINED BY HAND ★
 *
 * "Automatically added when it goes stale" falls straight out of rebuilding the whole board from
 * the market table every half hour: crossing the ninety-day believability band IS how a station
 * appears, and any fresh observation — a member's upload, an anonymous relay message — is how it
 * leaves. Nothing has to remember to enqueue or dequeue anything, so nothing can forget to.
 *
 * The half-hour cadence is the honesty limit: a claim consumes its board row instantly (the award
 * path in market-live does that, atomically), so the only staleness the cadence can cause is a
 * bounty appearing up to thirty minutes late.
 *
 * ★ THE SCORING ★
 *
 *   points   = days beyond zero it has gone unobserved, capped at five years (1825)
 *   never    = 1000 flat — a station we hold NO market for outranks 2.7 years of stale
 *   jackpot  = in squadron space AND (a year stale, or never seen): points doubled, badge worn
 *
 * Squadron space is everywhere within 200 ly of an active colonisation project — the space the
 * squadron actually flies. The galaxy tail below it is the stalest of everything else, for the
 * long-haul runners.
 *
 * ★ CARRIERS ARE EXCLUDED ★
 *
 * A bounty is an instruction to dock somewhere. A fleet carrier moves: by the time a member flies
 * to where the data was observed, the carrier is somewhere else, and the board would be paying
 * people to chase ghosts. (Live carrier positions are their own capture table now — a later board
 * could use them; a listing pointing at a five-month-old carrier sighting cannot be honest today.)
 */
export interface BountyBoardReport {
  readonly ops: number;
  readonly galaxy: number;
  readonly jackpots: number;
}

/** Matches the believability band the shopping and commodity rankings use. */
const BELIEVABLE_DAYS = 90;
const OPS_RADIUS_LY = 200;
const OPS_LIMIT = 300;
const GALAXY_LIMIT = 200;

export async function rebuildBountyBoard(db: PrismaClient): Promise<BountyBoardReport> {
  return db.$transaction(
    async (tx) => {
      /*
       * If the nightly market rebuild holds its lock, waiting here would stack this job behind a
       * multi-minute exclusive lock for no benefit — the board would be rebuilt from the OLD table
       * anyway. Two minutes, then give up and let the next half-hour tick try again.
       */
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '120s'`);

      /*
       * Where the squadron operates: the systems of every active colonisation project. id64 is
       * preferred (exact); the name path behind it requires all rows bearing the name to agree,
       * same rule as provisional station placement.
       */
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE bounty_anchors ON COMMIT DROP AS
        SELECT DISTINCT k.coords
          FROM colony_projects p
          JOIN knowledge_items k
            ON k.kind = 'system'
           AND k.source IN ('galaxy', 'eddn')
           AND k.coords IS NOT NULL
           AND (
                 (p.system_id64 IS NOT NULL AND k.ext_key = p.system_id64::text)
              OR (p.system_id64 IS NULL AND k.name = p.system_name)
               )
         WHERE p.completed_at IS NULL`);

      /*
       * One pass over the market table: the newest observation per station. This is the heavy
       * statement (a hash aggregate over the whole table) and the reason the board is a snapshot
       * — nothing a member's page loads should ever pay this cost.
       */
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE bounty_seen ON COMMIT DROP AS
        SELECT station_key, max(market_seen_at) AS last_seen, max(station_type) AS station_type
          FROM market_entries
         GROUP BY station_key`);

      await tx.$executeRawUnsafe(`DELETE FROM data_bounties`);

      /*
       * Squadron space: every station near an anchor whose data is missing or past the band.
       * Metadata comes from the station's knowledge row — the market table might hold nothing at
       * all for it, which is precisely the biggest bounty there is.
       */
      const ops = await tx.$executeRawUnsafe(`
        INSERT INTO data_bounties
          (station_key, station_name, system_name, station_type, large_pads,
           last_seen_at, days_stale, points, jackpot, in_ops, distance_ly, computed_at)
        SELECT
          k.ext_key,
          k.name,
          COALESCE(k.data->>'system', ''),
          k.data->>'type',
          (k.data->'landingPads'->>'large')::int,
          s.last_seen,
          CASE WHEN s.last_seen IS NULL THEN NULL
               ELSE (extract(epoch FROM now() - s.last_seen) / 86400)::int END,
          (CASE WHEN s.last_seen IS NULL THEN 1000
                ELSE LEAST((extract(epoch FROM now() - s.last_seen) / 86400)::int, 1825) END)
            * (CASE WHEN s.last_seen IS NULL
                      OR s.last_seen < now() - interval '365 days' THEN 2 ELSE 1 END),
          (s.last_seen IS NULL OR s.last_seen < now() - interval '365 days'),
          true,
          a.dist,
          now()
        FROM knowledge_items k
        LEFT JOIN bounty_seen s ON s.station_key = k.ext_key
        JOIN LATERAL (
          SELECT min(cube_distance(k.coords, ba.coords)) AS dist
            FROM bounty_anchors ba
           WHERE k.coords <@ cube_enlarge(ba.coords, ${OPS_RADIUS_LY}, 3)
             AND cube_distance(k.coords, ba.coords) <= ${OPS_RADIUS_LY}
        ) a ON a.dist IS NOT NULL
        WHERE k.kind = 'station'
          AND k.coords IS NOT NULL
          AND (k.data->>'type' IS NULL OR k.data->>'type' NOT ILIKE '%carrier%')
          AND (s.last_seen IS NULL OR s.last_seen < now() - interval '${BELIEVABLE_DAYS} days')
        ORDER BY 8 DESC, k.ext_key
        LIMIT ${OPS_LIMIT}`);

      /*
       * The galaxy tail: the stalest stations anywhere that still hold market rows. Ordered
       * oldest-first BEFORE the metadata join so only the chosen few pay for it.
       */
      const galaxy = await tx.$executeRawUnsafe(`
        INSERT INTO data_bounties
          (station_key, station_name, system_name, station_type, large_pads,
           last_seen_at, days_stale, points, jackpot, in_ops, distance_ly, computed_at)
        SELECT
          pick.station_key,
          k.name,
          COALESCE(k.data->>'system', ''),
          k.data->>'type',
          (k.data->'landingPads'->>'large')::int,
          pick.last_seen,
          (extract(epoch FROM now() - pick.last_seen) / 86400)::int,
          LEAST((extract(epoch FROM now() - pick.last_seen) / 86400)::int, 1825),
          false,
          false,
          NULL,
          now()
        FROM (
          /*
           * Carriers are excluded BEFORE the candidate window, not after. The first board proved
           * why: the stalest keys in the whole table are almost all carriers, so filtering after
           * the LIMIT left six real stations out of four hundred candidates.
           */
          SELECT station_key, last_seen
            FROM bounty_seen
           WHERE last_seen IS NOT NULL
             AND last_seen < now() - interval '${BELIEVABLE_DAYS} days'
             AND (station_type IS NULL OR station_type NOT ILIKE '%carrier%')
           ORDER BY last_seen ASC, station_key
           LIMIT ${GALAXY_LIMIT * 2}
        ) pick
        JOIN knowledge_items k ON k.kind = 'station' AND k.ext_key = pick.station_key
        ORDER BY pick.last_seen ASC
        LIMIT ${GALAXY_LIMIT}
        ON CONFLICT (station_key) DO NOTHING`);

      const [j] = await tx.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM data_bounties WHERE jackpot`,
      );

      return { ops, galaxy, jackpots: j?.n ?? 0 };
    },
    // The aggregate alone can take a while on spinning production disks; leave generous room.
    { timeout: 180_000 },
  );
}
