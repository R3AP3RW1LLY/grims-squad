import type { PrismaClient } from '@grims/db';

/**
 * Flattening station markets into one row per commodity.
 *
 * ★ WHY, IN ONE SENTENCE ★
 *
 * `knowledge_items.data->'market'` is the right shape for "what does this station trade" and the
 * wrong shape for "where can I buy Platinum cheaply" — the second has to expand a JSONB array on
 * every one of 275,000 stations before it can filter.
 *
 * On 2026-07-31 a route query over that structure spilled to temp until it exhausted the disk and
 * took the Docker engine down with it. Leg-by-leg it survives; as a member-facing feature answering
 * arbitrary routes, it would not have.
 *
 * ★ REBUILT WHOLESALE, NOT UPDATED IN PLACE ★
 *
 * This table is DERIVED — every row can be recomputed from knowledge_items. Diffing tens of millions
 * of rows to apply changes would cost more than rebuilding, and would leave the table subtly wrong
 * whenever a station stops trading something (the old row has nothing to update it).
 *
 * Rebuilt inside a transaction so route queries never see a half-empty market.
 */

/**
 * Rebuilds the whole table from the knowledge store.
 *
 * ★ SET-BASED, NOT ROW-BY-ROW ★
 *
 * One INSERT ... SELECT rather than reading rows into Node and writing them back. The data never
 * leaves Postgres, which for ~27M rows is the difference between a couple of minutes and an
 * afternoon — and it cannot run out of heap part way.
 */
/**
 * The indexes, dropped before the bulk load and rebuilt after.
 *
 * ★ DUPLICATED FROM THE MIGRATION, AND THAT IS A REAL COST ★
 *
 * These definitions exist in `20260801100000_market_entries/migration.sql` as well. Two copies can
 * drift, and the drift would be silent: a rebuild would recreate the OLD shape and every query
 * would quietly get slower with nothing failing.
 *
 * The alternative is reading `pg_indexes` and replaying whatever is there, which sounds safer and
 * is worse — it would faithfully reproduce a bad index somebody added by hand, and it hides what
 * this table's access patterns actually are. `market-flatten.spec` asserts these match the
 * migration, which turns the drift into a test failure rather than a mystery.
 */
const INDEXES = [
  'market_entries_buy_idx',
  'market_entries_sell_idx',
  'market_entries_coords_idx',
  'market_entries_station_idx',
  'market_entries_commodity_trgm_idx',
  // ★ ADDED AFTER THE OUTAGE OF 2026-08-06 ★
  //
  // Without this in the drop-and-rebuild list the bulk insert below would maintain a GiST index
  // over five and a half million rows one row at a time, which is precisely the cost this whole
  // shape exists to avoid. Its absence would not fail — it would just make the nightly rebuild
  // take hours longer, silently.
  'market_entries_buy_coords_idx',
  // ★ AND THIS ONE HAD BEEN MISSING ALL ALONG ★
  //
  // Found on 2026-08-06 by widening the drift test to read EVERY migration rather than only the
  // one that first created the table. It has existed in a migration since the live-rows fix and
  // was never in this list, so every rebuild since has maintained it a row at a time through the
  // bulk insert below — exactly the cost this shape exists to avoid.
  //
  // Safe to drop here: the `live_keep` snapshot is taken further down but BEFORE the drops, and
  // that snapshot is the one query this index serves.
  'market_entries_live_source_idx',
] as const;

const INDEX_DDL = [
  // "where can I BUY <commodity> cheaply" — supply first, then price ascending.
  `CREATE INDEX "market_entries_buy_idx" ON "market_entries" ("commodity", "buy_price" ASC)
     WHERE "supply" > 0 AND "buy_price" > 0`,
  // "where can I SELL <commodity> dearly" — demand first, then price descending.
  `CREATE INDEX "market_entries_sell_idx" ON "market_entries" ("commodity", "sell_price" DESC)
     WHERE "demand" > 0 AND "sell_price" > 0`,
  // Spatial: "within N light years of here".
  `CREATE INDEX "market_entries_coords_idx" ON "market_entries" USING gist ("coords")
     WHERE "coords" IS NOT NULL`,
  // "what does THIS station trade" — the reverse lookup, for a station page.
  `CREATE INDEX "market_entries_station_idx" ON "market_entries" ("station_key")`,
  // Fuzzy commodity names, so "platinium" still finds Platinum.
  `CREATE INDEX "market_entries_commodity_trgm_idx" ON "market_entries" USING gin ("commodity" gin_trgm_ops)`,
  /*
   * ★ "WHERE CAN I BUY THIS, NEAREST FIRST" — THE QUERY THAT TOOK SEVENTY SECONDS ★
   *
   * `WHERE commodity = $1 ... ORDER BY coords <-> origin LIMIT 1`. With only the plain coords GiST
   * index, Postgres walks outward from the origin nearest-first and applies `commodity` as a
   * filter — so when nothing within range sells it, the scan crawls the galaxy to prove a negative.
   * Measured at a real origin: 88.8s, and the answer was an empty set.
   *
   * btree_gist lets the scalar equality share the GiST index with the cube, scoping the walk to one
   * commodity before it starts. Same six commodities afterwards: 0.27s, 0.43s, 0.02s, 0.26s, 0.15s,
   * 0.19s.
   *
   * Partial on the buy predicate: 5.5M of the 18.9M rows can actually be bought, which is the
   * difference between 708 MB and several gigabytes, and every query using it already carries those
   * predicates.
   */
  `CREATE INDEX "market_entries_buy_coords_idx" ON "market_entries" USING gist ("commodity", "coords")
     WHERE "supply" > 0 AND "buy_price" > 0 AND "coords" IS NOT NULL`,
  // "which stations have live rows" — the preservation pass's own lookup, once per rebuild.
  // Partial because 'dump' rows are the overwhelming majority and are never looked up by source.
  `CREATE INDEX "market_entries_live_source_idx" ON "market_entries" ("station_key")
     WHERE "source" <> 'dump'`,
] as const;

export async function rebuildMarketEntries(db: PrismaClient): Promise<number> {
  const written = await db.$transaction(
    async (tx) => {
      /*
       * TRUNCATE, not DELETE. DELETE on tens of millions of rows writes a dead tuple for each and
       * leaves the table needing a vacuum before it is fast again; TRUNCATE reclaims immediately.
       *
       * Inside the transaction, so readers keep seeing the old table until the new one is committed.
       * A member asking for a route mid-rebuild gets yesterday's answer rather than no answer.
       */
      /*
       * ★ LIVE OBSERVATIONS SURVIVE THE REBUILD — THE FIX FOR AN HOURLY DATA MASSACRE ★
       *
       * Measured 2026-08-04: EDDN wrote 398,877 market rows between 04:59 and 06:21; after the
       * 06:39 rebuild the table contained ZERO of them. The dump's own freshest row is over a day
       * old at the moment it lands (its median station age is 118 days), so every rebuild replaced
       * live data with older data, wholesale, and the "real time" market the owner asked for could
       * never exist for longer than the gap between two rebuilds.
       *
       * The rule is per STATION, and it is "keep whichever observation is newer" — not "keep
       * everything live". A live row from March loses to a dump row from yesterday, exactly as it
       * should: provenance says where a row came from, the timestamp says whether it still wins.
       *
       * TEMP ON COMMIT DROP, inside this same transaction, so the backup lives exactly as long as
       * the rebuild and a crash cannot leave it behind. Prisma's interactive transaction runs on
       * one connection, which is what makes a TEMP table usable here at all.
       */
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE live_keep ON COMMIT DROP AS
           SELECT * FROM market_entries WHERE source <> 'dump'`,
      );

      await tx.$executeRawUnsafe(`TRUNCATE TABLE market_entries`);

      /*
       * ★ INDEXES DROPPED FIRST, REBUILT AFTER — MEASURED, NOT ASSUMED ★
       *
       * The first real run of this took over half an hour on a development machine with the
       * indexes in place, and production is a single vCPU. Five indexes over twenty-seven million
       * rows means five index writes PER ROW, and the GIN trigram index is the worst of them: it
       * tokenises every commodity name into three-character grams and merges them into a pending
       * list on every insert.
       *
       * Built afterwards, each index is one sequential pass over data already in place — the
       * standard bulk-load shape, and typically several times faster in total.
       *
       * ★ SAFE BECAUSE POSTGRES MAKES DDL TRANSACTIONAL ★
       *
       * The drops, the insert and the creates are all inside this transaction. A failure anywhere
       * rolls the indexes back with the data; there is no window in which the table exists
       * un-indexed to anybody else, and a crash mid-rebuild cannot leave the route queries doing
       * sequential scans over twenty-seven million rows.
       *
       * NOT `CREATE INDEX CONCURRENTLY`, for that exact reason — it cannot run in a transaction,
       * which is the property this depends on.
       */
      for (const name of INDEXES) {
        await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "${name}"`);
      }

      /*
       * ★ THE INSERT'S OWN ROW COUNT, NOT A COUNT(*) AFTERWARDS ★
       *
       * This ended with `SELECT COUNT(*) FROM market_entries` — a full scan of twenty-seven
       * million rows, run INSIDE the transaction, while still holding the ACCESS EXCLUSIVE lock
       * that TRUNCATE took. Every reader of the table waits for it, and it exists only to report a
       * number Postgres had already returned.
       *
       * Watched happen: the insert completed and the rebuild kept the table locked for minutes
       * afterwards, counting rows it had just written.
       */
      const written = await tx.$executeRawUnsafe(`
        INSERT INTO market_entries (
          station_key, station_name, system_name, station_type, coords, large_pads, medium_pads,
          commodity, category, buy_price, sell_price, supply, demand, source, market_seen_at)
        SELECT
          k.ext_key,
          k.name,
          k.data->>'system',
          k.data->>'type',
          k.coords,
          COALESCE((k.data->'landingPads'->>'large')::int, 0),
          -- Medium joined 2026-08-06: 54% of stations have no large pad, so "large only" was the
          -- only pad question this table could answer and it is the wrong one for a medium hull.
          COALESCE((k.data->'landingPads'->>'medium')::int, 0),
          c->>'name',
          c->>'category',
          COALESCE((c->>'buyPrice')::int, 0),
          COALESCE((c->>'sellPrice')::int, 0),
          COALESCE((c->>'supply')::int, 0),
          COALESCE((c->>'demand')::int, 0),
          'dump',
          /*
           * Spansh gives this per market as an ISO string. Cast defensively: one unparseable
           * timestamp must not abort a rebuild of the entire galaxy.
           */
          NULLIF(k.data->>'marketUpdatedAt', '')::timestamptz
        FROM knowledge_items k
        /*
         * ★ THE STATION'S LARGEST REPORTED QUANTITY, COMPUTED ONCE ★
         *
         * Needed by the WHERE clause below. As a correlated subquery per commodity it would
         * re-scan the station's whole market for every one of its ~100 rows; as a lateral it is
         * one extra pass per station.
         */
        CROSS JOIN LATERAL (
          SELECT COALESCE(MAX(GREATEST(
                   COALESCE((x->>'supply')::int, 0),
                   COALESCE((x->>'demand')::int, 0))), 0) AS max_qty
            FROM jsonb_array_elements(k.data->'market') x
        ) q
        CROSS JOIN LATERAL jsonb_array_elements(k.data->'market') c
        WHERE k.source = 'galaxy'
          AND k.kind = 'station'
          AND jsonb_typeof(k.data->'market') = 'array'
          /*
           * ★ KEEP WHAT CAN ACTUALLY BE TRADED — AND ZERO MEANS TWO DIFFERENT THINGS ★
           *
           * On an ordinary station, supply 0 and demand 0 means the commodity is not traded there.
           * Measured on 400 Coriolis starports: 43,220 such rows against 42,687 real ones, all
           * still carrying a reference price. Keeping them would roughly DOUBLE this table with
           * rows no query can ever usefully return — you cannot buy what has no stock.
           *
           * On a SPACE CONSTRUCTION DEPOT, every commodity reports 0/0 while carrying real buy and
           * sell prices. Zero there is "not reported", not "none in stock" — and the first version
           * of this filter therefore excluded all 36,950 of them. The squadron owner had asked for
           * construction sites explicitly ("we also need all ground stations constructuon sites
           * etc ... anywhere we can buy from and sell too"), and the table looked complete: it had
           * eighteen million rows and every other station type in it.
           *
           * So the rule is per STATION rather than per row. A station that reports a quantity
           * anywhere is believed about its zeros; a station that reports none anywhere is one
           * whose quantities are simply absent, and its priced rows are kept.
           */
          AND (
            COALESCE((c->>'supply')::int, 0) > 0
            OR COALESCE((c->>'demand')::int, 0) > 0
            OR (q.max_qty = 0
                AND (COALESCE((c->>'buyPrice')::int, 0) > 0
                     OR COALESCE((c->>'sellPrice')::int, 0) > 0))
          )
      `);

      /*
       * The merge: for each station that has live rows, compare its newest live observation with
       * the newest thing the dump just wrote for it. Whichever is fresher keeps the station —
       * whole-station, because every writer here replaces whole stations, and mixing a dump row
       * with a live row for one station would resurrect exactly the stopped-trading commodities
       * the replace semantics exist to kill.
       *
       * Runs BEFORE the indexes are recreated, so the restore insert is a plain heap append.
       */
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE keep_stations ON COMMIT DROP AS
           SELECT lk.station_key
             FROM (SELECT station_key, max(market_seen_at) AS live_max
                     FROM live_keep GROUP BY station_key) lk
             LEFT JOIN (SELECT station_key, max(market_seen_at) AS dump_max
                          FROM market_entries
                         WHERE station_key IN (SELECT DISTINCT station_key FROM live_keep)
                         GROUP BY station_key) dk USING (station_key)
            WHERE dk.dump_max IS NULL OR lk.live_max > dk.dump_max`,
      );

      await tx.$executeRawUnsafe(
        `DELETE FROM market_entries
          WHERE station_key IN (SELECT station_key FROM keep_stations)`,
      );
      const preserved = await tx.$executeRawUnsafe(
        `INSERT INTO market_entries
           SELECT * FROM live_keep
            WHERE station_key IN (SELECT station_key FROM keep_stations)`,
      );
      if (preserved > 0) {
        console.log(`markets: preserved ${preserved} live rows fresher than the dump`);
      }

      for (const ddl of INDEX_DDL) {
        await tx.$executeRawUnsafe(ddl);
      }

      return written;
    },
    /*
     * The galaxy is tens of millions of rows; the default 5s transaction timeout is nowhere near.
     *
     * ★ AND NEITHER WAS THIRTY MINUTES — MEASURED IN PRODUCTION, 2026-08-05 ★
     *
     * The first full rebuild on the production box ran 2,086,389 ms — about thirty-five minutes —
     * and Prisma closed the transaction under it at thirty. The failure is quiet in the worst way:
     * `market_entries` stays EMPTY, so the EDDN collector finds no commodity names and parks itself
     * ("no commodity names available — waiting"), the market pages have nothing to show, and the
     * Data Bounty board has no stations to rank. One expired transaction reads as four broken
     * features.
     *
     * Four hours, not thirty-five minutes: the number has to survive a slower disk, a bigger dump
     * and a box that is also serving the site, and the cost of being generous is a transaction that
     * holds its snapshot longer on the rare occasion something really is wrong. The cost of being
     * tight is the outage above.
     */
    { timeout: 4 * 60 * 60_000, maxWait: 60_000 },
  );

  /*
   * ★ ANALYZE, AFTER THE COMMIT — AND THE REASON THAT MATTERS ★
   *
   * This used to be the last statement INSIDE the transaction above, and it was not enough.
   *
   * Measured in production on 2026-08-06: Postgres believed this table held 30,281 rows. It held
   * 18,847,651. `pg_stat_user_tables` reported `last_analyze = never` and `last_autoanalyze =
   * never`, and every plan touching the largest table in the database was costed from a number six
   * hundred times too small.
   *
   * What that cost: at a real commander's position, "cheapest source of this commodity within
   * 100 ly" took SEVENTY TO ONE HUNDRED AND FIFTEEN SECONDS and returned nothing. Believing the
   * table tiny, the planner chose a KNN walk over the coords index with `commodity` as a
   * post-filter, so it crawled outward through the galaxy discarding rows. The colonisation page
   * fires one of those per commodity; the companion app retried; the API's entire connection pool
   * went to a single endpoint and the site fell over.
   *
   * The planner statistics themselves are transactional and did land. The CUMULATIVE COUNTERS are
   * not — they are reported to the stats collector separately, and a TRUNCATE inside a transaction
   * that later rolls back or times out (this rebuild has done both) leaves them describing a table
   * that no longer exists. Autovacuum then reads those counters, concludes a 30,000-row table is
   * not worth visiting, and never corrects them. It had never once run on this table.
   *
   * Running it here, on the pooled client after the commit, means the statistics are taken from
   * the committed table and the counters are reported where every planner afterwards can see them.
   *
   * It is deliberately NOT inside the transaction and deliberately NOT on `tx`: that client is
   * invalid the moment the callback returns.
   */
  await db.$executeRawUnsafe(`ANALYZE market_entries`);

  return written;
}
