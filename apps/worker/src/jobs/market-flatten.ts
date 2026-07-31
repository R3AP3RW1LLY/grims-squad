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
] as const;

export async function rebuildMarketEntries(db: PrismaClient): Promise<number> {
  return db.$transaction(
    async (tx) => {
      /*
       * TRUNCATE, not DELETE. DELETE on tens of millions of rows writes a dead tuple for each and
       * leaves the table needing a vacuum before it is fast again; TRUNCATE reclaims immediately.
       *
       * Inside the transaction, so readers keep seeing the old table until the new one is committed.
       * A member asking for a route mid-rebuild gets yesterday's answer rather than no answer.
       */
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
          station_key, station_name, system_name, station_type, coords, large_pads,
          commodity, category, buy_price, sell_price, supply, demand, market_seen_at)
        SELECT
          k.ext_key,
          k.name,
          k.data->>'system',
          k.data->>'type',
          k.coords,
          COALESCE((k.data->'landingPads'->>'large')::int, 0),
          c->>'name',
          c->>'category',
          COALESCE((c->>'buyPrice')::int, 0),
          COALESCE((c->>'sellPrice')::int, 0),
          COALESCE((c->>'supply')::int, 0),
          COALESCE((c->>'demand')::int, 0),
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

      for (const ddl of INDEX_DDL) {
        await tx.$executeRawUnsafe(ddl);
      }

      /*
       * ANALYZE, explicitly. Autovacuum will get to it eventually, and until it does the planner
       * has statistics from an empty table — which is how a perfectly good index gets ignored in
       * favour of a sequential scan for the first several minutes after every rebuild.
       */
      await tx.$executeRawUnsafe(`ANALYZE market_entries`);

      return written;
    },
    // The galaxy is tens of millions of rows; the default 5s transaction timeout is nowhere near.
    { timeout: 30 * 60_000, maxWait: 60_000 },
  );
}
