import type { PrismaClient } from '@grims/db';
// A `site_config` row rather than a column: it describes the BOARD, not any one bounty, and
// `data_bounties` is deleted and rebuilt wholesale every half hour.
import { BOUNTY_ANCHOR_COUNT_KEY } from '@grims/shared';

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

/**
 * ★ THE SCALE COLLAPSED, AND TOOK WHOLE SYSTEMS OFF THE BOARD WITH IT — 2026-08-08 ★
 *
 * A member cleared one bounty in BD+16 1001 and watched the rest of the system vanish. The claim
 * was not the cause; claiming deletes one row, keyed by station. The cut line was.
 *
 * Measured on production that morning: 300 ops rows, 284 of them tied at the 3,650 ceiling, cut
 * line 3,642, one system (Khwar) holding twenty slots, and not one never-seen station anywhere on
 * the board. Almost every stale market row we hold dates from the same 2021 import, so once that
 * data aged past the five-year cap the scores stopped distinguishing anything: the board became
 * three hundred ties, and the cut climbed two points a day.
 *
 * A system's stations share an import timestamp, so they share a score, so they cross the line as
 * a block. That is the whole bug — twenty bounties disappearing between one half-hourly rebuild
 * and the next, with nothing in the product to explain it.
 */

/** Beyond this a station is simply "ancient" and the exact figure stops carrying information. */
export const STALE_CAP_DAYS = 1825;

/**
 * A station we hold NO market for, scored so it outranks the stalest one we do.
 *
 * The header has always claimed this ("a station we hold NO market for outranks 2.7 years of
 * stale", "precisely the biggest bounty there is") and the arithmetic stopped honouring it years
 * ago: 1,000 against a capped 1,825 meant never-seen sank below anything older than 1,000 days.
 * Production held zero of them. Above the cap, so the claim is true at every multiplier.
 */
export const NEVER_SEEN_POINTS = 2000;

/**
 * How many stations one system may put on the board at once.
 *
 * ★ THE FIX FOR THE BLOCK EVICTION ★
 *
 * Three, not twenty. A system whose stations all score alike can no longer occupy a twentieth of
 * the board and then lose the lot in one rebuild; it shows its best three, and as those are
 * claimed the next three rotate in — which is the behaviour the member expected in the first
 * place. It also widens coverage: three hundred slots now reach at least a hundred systems.
 */
export const PER_SYSTEM_LIMIT = 3;

/**
 * A station a member could actually file a market report from.
 *
 * ★ 72 OF THE 496 BOUNTIES ON THE BOARD COULD NOT BE CLEARED — MEASURED 2026-08-16 ★
 *
 * A bounty is an instruction to fly somewhere and bring back a market. If the station has no market
 * to bring back, the trip is wasted and the bounty NEVER clears: nothing can refresh it, so it sits
 * at the top of the board for ever, paying nobody and displacing a station somebody could have
 * helped with.
 *
 * Fifty-seven Outposts, one Planetary Outpost and fourteen stations we hold no catalogue row for at
 * all. The member who flew to one had no way to know, and no way to say so.
 *
 * ★ ABSENT IS NOT THE SAME AS UNKNOWN, AND THE DIFFERENCE DECIDES 459 STATIONS ★
 *
 * The rule is deliberately `services is an array AND that array lacks Market` — NOT `services does
 * not contain Market`. Four hundred and fifty-nine stations carry no services data whatsoever, and
 * under the shorter form every one would be struck off. "We have never been told what this station
 * offers" is the strongest possible case for sending somebody to look, not a reason to stop.
 *
 * ★ AND IT IS A FILTER, NOT A PROOF ★
 *
 * The services list comes from the galaxy dump and can be stale: a station that has GAINED a market
 * since the last import still reads as marketless here. That is why this is one layer of several
 * rather than the answer — a member who flies out and finds a market anyway refreshes it, and the
 * upload clears the bounty by the ordinary path.
 *
 * ★ THE `COALESCE` IS LOAD-BEARING, AND IT IS NOT DEFENSIVE STYLE ★
 *
 * Written without it first. For a station carrying no services key, `k.data->'services'` is SQL
 * NULL, so `jsonb_typeof(NULL) = 'array'` is NULL, the conjunction is NULL, and `NOT NULL` is NULL
 * — which a WHERE clause discards. The predicate meant to protect the 459 unknown stations was
 * silently removing every one of them, including the never-seen station this job's own header calls
 * "precisely the biggest bounty there is".
 *
 * Nothing about the SQL looked wrong; it read exactly like the rule it was supposed to be. The
 * regression test caught it on the first run.
 */
const HAS_NO_MARKET = `COALESCE(jsonb_typeof(k.data->'services') = 'array'
                                AND NOT (k.data->'services' @> '["Market"]'::jsonb), false)`;

/**
 * Odyssey settlements, which the board should not be sending anybody to.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * Asked which types to drop, given settlements were 291 of the 496 rows — the majority of the whole
 * board, 116 of them never seen — the answer was settlements.
 *
 * The services list says they have markets and by its own lights it is right; what it cannot say is
 * whether a member in a ship can get to one. A board that is three-fifths settlements is a board
 * mostly made of trips that do not happen, and the stations somebody WOULD have flown to are the
 * ones being displaced.
 *
 * ★ BOTH SPELLINGS, DELIBERATELY ★
 *
 * `Settlement` and `OnFootSettlement` both appear in the catalogue. This codebase has already had a
 * carrier become unfindable because a query hard-coded one of two vocabularies for the same thing —
 * see `@grims/shared/carrier` — and matching one spelling here would leave the other on the board
 * with nothing to explain why.
 */
const IS_SETTLEMENT = `k.data->>'type' IN ('Settlement', 'OnFootSettlement')`;

/**
 * A station a member has flown to and reported has no market.
 *
 * ★ WHY THE BOARD HAS TO READ THIS AND NOT JUST TRUST THE DELETE ★
 *
 * Reporting one pays the member and removes the row, exactly as a market upload does. But an upload
 * also makes the market data FRESH, which is what stops the next rebuild re-listing the station.
 * A negative report writes no market data at all — so without this clause the bounty would be back
 * within thirty minutes, the next member would fly the same wasted trip, and the report would have
 * bought nothing but one payment.
 *
 * `cleared_at` is an officer overturning a report: the station returns from the next rebuild, which
 * is the whole reversal mechanism. A report is trusted on one verified commander's word, and the
 * answer to trusting people is not to stop, it is to be able to correct it.
 */
const REPORTED_NO_MARKET = `EXISTS (
                    SELECT 1 FROM station_no_market nm
                     WHERE nm.station_key = k.ext_key AND nm.cleared_at IS NULL
                  )`;

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
           AND k.source IN ('galaxy', 'eddn', 'companion')
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

      /*
       * ★ RECORDED, BECAUSE AN EMPTY OPS LIST HAS TWO MEANINGS ★
       *
       * Squadron space is defined relative to active colonisation projects. With none, the
       * section is empty because it is UNDEFINED — not because everything near us is fresh — and
       * the page said "squadron space is lit" for both, which is a claim that all our nearby data
       * is current. Reported by the squadron owner on 2026-08-05.
       *
       * Written here rather than counted at read time, for two reasons. `colony_projects` carries
       * an ACL and the board endpoint is public, so reading it there would put an ACL-bearing
       * model behind a plain client (INV-002) — and the honest number is not "how many projects
       * exist right now" but "how many this board was built from". A project started two minutes
       * ago is a real third state, and anchoring the sentence to the build keeps it true.
       */
      const anchorRows = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM bounty_anchors`,
      );
      const anchors = Number(anchorRows[0]?.n ?? 0);
      /*
       * `to_jsonb`, because the column is jsonb and not text. Written without it first, which
       * Postgres rejected — and the rejection went nowhere, so the key was simply never there and
       * the page went on reporting "no active projects" while three were running.
       */
      await tx.$executeRawUnsafe(
        `INSERT INTO site_config (key, value) VALUES ($1, to_jsonb($2::int))
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        BOUNTY_ANCHOR_COUNT_KEY,
        anchors,
      );

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
        SELECT station_key, station_name, system_name, station_type, large_pads,
               last_seen, days_stale, points, jackpot, true, dist, now()
          FROM (
            /*
             * ★ AT MOST ${PER_SYSTEM_LIMIT} PER SYSTEM, RANKED INSIDE THE SYSTEM FIRST ★
             *
             * A window, not a correlated subquery. The first version of this fix asked, for every
             * candidate, how many better ones its system held — which is quadratic and took the
             * rebuild past two minutes against 18.8M market rows. The window ranks each system's
             * candidates in one pass over the same set that was already being sorted.
             *
             * The cap is what stops a system putting twenty near-identical scores shoulder to
             * shoulder at the cut line, where they are all evicted by the same two-point drift.
             */
            /*
             * ★ TIES BREAK ON DISTANCE, NOT ON STATION KEY — SQUADRON OWNER, 2026-08-16 ★
             *
             * Measured: 299 of the 496 rows scored EXACTLY 4,000. Every never-seen station ties,
             * because never-seen is a flat score by construction — so the order among three fifths
             * of the board was station_key ascending, which is to say arbitrary, and so was which
             * of them fell off at the cut line.
             *
             * That is the same shape as the block eviction in BD+16 1001 documented above, arrived
             * at from the other direction: not one system's stations sharing a timestamp, but every
             * never-seen station sharing a score.
             *
             * Distance is the tiebreak that means something to a member. Same points, ordered by
             * how far they would actually have to fly, so the top of the board is the reachable
             * work. station_key stays as the final term to keep the ordering total and the
             * rebuild deterministic.
             */
            SELECT *, ROW_NUMBER() OVER (
                        PARTITION BY system_name
                            ORDER BY points DESC, dist ASC, station_key
                      ) AS rank_in_system
              FROM (
                SELECT
                  k.ext_key                          AS station_key,
                  k.name                             AS station_name,
                  COALESCE(k.data->>'system', '')    AS system_name,
                  k.data->>'type'                    AS station_type,
                  (k.data->'landingPads'->>'large')::int AS large_pads,
                  s.last_seen                        AS last_seen,
                  CASE WHEN s.last_seen IS NULL THEN NULL
                       ELSE (extract(epoch FROM now() - s.last_seen) / 86400)::int END AS days_stale,
                  (CASE WHEN s.last_seen IS NULL THEN ${NEVER_SEEN_POINTS}
                        ELSE LEAST((extract(epoch FROM now() - s.last_seen) / 86400)::int,
                                   ${STALE_CAP_DAYS}) END)
                    * (CASE WHEN s.last_seen IS NULL
                              OR s.last_seen < now() - interval '365 days' THEN 2 ELSE 1 END)
                                                     AS points,
                  (s.last_seen IS NULL OR s.last_seen < now() - interval '365 days') AS jackpot,
                  a.dist                             AS dist
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
                  -- A station with no market cannot be refreshed, so a bounty on it never clears.
                  AND NOT ${HAS_NO_MARKET}
                  AND NOT ${IS_SETTLEMENT}
                  AND NOT ${REPORTED_NO_MARKET}
                  AND (s.last_seen IS NULL
                       OR s.last_seen < now() - interval '${BELIEVABLE_DAYS} days')
              ) scored
          ) ranked
         WHERE rank_in_system <= ${PER_SYSTEM_LIMIT}
         -- The same tiebreak at the cut line, for the same reason: which of 299 tied rows survives
         -- must not be decided by how a station key happens to sort.
         ORDER BY points DESC, dist ASC, station_key
         LIMIT ${OPS_LIMIT}`);

      /*
       * The galaxy tail: the stalest stations anywhere that still hold market rows. Ordered
       * oldest-first BEFORE the metadata join so only the chosen few pay for it.
       */
      const galaxy = await tx.$executeRawUnsafe(`
        INSERT INTO data_bounties
          (station_key, station_name, system_name, station_type, large_pads,
           last_seen_at, days_stale, points, jackpot, in_ops, distance_ly, computed_at)
        SELECT station_key, station_name, system_name, station_type, large_pads,
               last_seen, days_stale, points, false, false, NULL, now()
          FROM (
            /*
             * ★ THE SAME PER-SYSTEM CAP AS THE OPS BOARD ★
             *
             * The tail had the identical defect and it is the half that actually bit: the ops list
             * capped at three and the tail then put all twelve of the same system's stations back.
             * Found by the regression test rather than by reading, which is the only reason the fix
             * is not still half done.
             */
            SELECT *, ROW_NUMBER() OVER (
                        PARTITION BY system_name
                            ORDER BY last_seen ASC, station_key
                      ) AS rank_in_system
              FROM (
                SELECT
                  pick.station_key                       AS station_key,
                  k.name                                 AS station_name,
                  COALESCE(k.data->>'system', '')        AS system_name,
                  k.data->>'type'                        AS station_type,
                  (k.data->'landingPads'->>'large')::int AS large_pads,
                  pick.last_seen                         AS last_seen,
                  (extract(epoch FROM now() - pick.last_seen) / 86400)::int AS days_stale,
                  LEAST((extract(epoch FROM now() - pick.last_seen) / 86400)::int,
                        ${STALE_CAP_DAYS})               AS points
                FROM (
                  /*
                   * Carriers are excluded BEFORE the candidate window, not after. The first board
                   * proved why: the stalest keys in the whole table are almost all carriers, so
                   * filtering after the LIMIT left six real stations out of four hundred candidates.
                   *
                   * The pool is deliberately far wider than the board. Diversity can only spread
                   * across systems that made the candidate list, and at twice the board size a
                   * handful of crowded systems used the whole pool up.
                   */
                  SELECT station_key, last_seen
                    FROM bounty_seen
                   WHERE last_seen IS NOT NULL
                     AND last_seen < now() - interval '${BELIEVABLE_DAYS} days'
                     AND (station_type IS NULL OR station_type NOT ILIKE '%carrier%')
                   ORDER BY last_seen ASC, station_key
                   LIMIT ${GALAXY_LIMIT * 10}
                ) pick
                JOIN knowledge_items k ON k.kind = 'station' AND k.ext_key = pick.station_key
                 -- Applied HERE as well, and the comment above about the per-system cap says why in
                 -- so many words: "the tail had the identical defect and it is the half that
                 -- actually bit". A filter on the ops list alone leaves the tail free to put every
                 -- marketless station straight back on the board.
                 AND NOT ${HAS_NO_MARKET}
                 AND NOT ${IS_SETTLEMENT}
                 AND NOT ${REPORTED_NO_MARKET}
              ) scored
          ) ranked
         WHERE rank_in_system <= ${PER_SYSTEM_LIMIT}
         ORDER BY last_seen ASC
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
