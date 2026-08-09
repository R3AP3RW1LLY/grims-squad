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
 * ★ BUILT BESIDE THE LIVE TABLE, THEN SWAPPED IN — REWRITTEN 2026-08-09 ★
 *
 * This used to rebuild the table in place: TRUNCATE, drop the indexes, reload, recreate them, all
 * inside one transaction so readers kept seeing the old data until it committed. Readers did keep
 * seeing the old data. They just could not reach it.
 *
 * TRUNCATE takes ACCESS EXCLUSIVE, and Postgres holds a lock until COMMIT. So the table members
 * read was locked for as long as the rebuild took, which on 2026-08-09 was forty minutes and
 * twenty seconds:
 *
 *   INSERT .. SELECT              24.8 min
 *   CREATE INDEX .. gist(coords)  11.1 min
 *   the other five indexes         4.6 min
 *
 * Every API request touching `market_entries` then queued on that lock while holding one of the
 * twenty-five connections in the pool. The pool was fully consumed 52 seconds after the TRUNCATE,
 * and from then on requests that had nothing to do with markets — reading `device_pairings`, or
 * `sessions` — failed too, because there was no connection left to serve them. 1,486 pool timeouts
 * between 06:13:39 and 06:52:27, stopping dead at the commit.
 *
 * The lesson is narrower than "TRUNCATE is slow". TRUNCATE itself measures 0.0s, and swapping it
 * for something gentler would have changed nothing: the seven DROP INDEX statements that followed
 * take the same lock anyway, and the cost was never the statement — it was holding ANY exclusive
 * lock across forty minutes of work.
 *
 * So the work happens somewhere nobody is reading. `market_entries_next` is loaded, merged and
 * indexed with the live table untouched, and only then are the two swapped by renaming them, which
 * is a catalogue update measured in milliseconds. The live table is exclusively locked for the
 * length of that rename and at no other point.
 *
 * ★ WHAT THE OLD SHAPE GOT RIGHT, AND IS KEPT ★
 *
 * Rebuilt wholesale rather than diffed: every row here is derived from knowledge_items, and diffing
 * tens of millions of rows would cost more than rebuilding while leaving the table subtly wrong
 * whenever a station stops trading something (the old row has nothing to update it).
 *
 * Indexes built after the bulk load rather than maintained during it — five index writes per row
 * over eighteen million rows is the difference between a job that finishes and one still running at
 * breakfast. On the shadow table this is now free of any locking consequence at all.
 */

/**
 * The indexes, built on the shadow table and renamed into place after the swap.
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
  // Without this in the rebuild list the bulk insert below would maintain a GiST index over five
  // and a half million rows one row at a time, which is precisely the cost this whole shape exists
  // to avoid. Its absence would not fail — it would just make the rebuild take hours longer,
  // silently.
  'market_entries_buy_coords_idx',
  // ★ AND THIS ONE HAD BEEN MISSING ALL ALONG ★
  //
  // Found on 2026-08-06 by widening the drift test to read EVERY migration rather than only the
  // one that first created the table. It has existed in a migration since the live-rows fix and
  // was never in this list, so every rebuild before then maintained it a row at a time through the
  // bulk insert — exactly the cost this shape exists to avoid.
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

/** Where the rebuild happens: a table nothing reads, so nothing can be blocked by it. */
const SHADOW = 'market_entries_next';

/** Where the outgoing table waits between the swap and its own removal. */
const RETIRED = 'market_entries_old';

/**
 * Every column carried between the tables.
 *
 * Named explicitly rather than `SELECT *`: `id` is deliberately NOT in this list, so a row moved
 * from the live table into the shadow takes a fresh sequence value instead of colliding with one
 * the bulk load already used. Nothing anywhere reads `market_entries.id` — it is a surrogate key
 * and no query, service or foreign key references it — so its values carry no meaning to preserve.
 */
const CARRIED = `station_key, station_name, system_name, station_type, coords, large_pads,
  medium_pads, commodity, category, buy_price, sell_price, supply, demand, source, market_seen_at`;

/**
 * The same index, pointed at the shadow table and named so it cannot collide.
 *
 * Derived from the canonical DDL rather than written twice, so the drift check above still reads
 * one list and the shadow can never be built with an index the live table does not get.
 */
export function onShadow(ddl: string): string {
  const renamed = ddl.replace(/CREATE INDEX "(market_entries_[a-z_]+)"/, `CREATE INDEX "$1_next"`);
  const retargeted = renamed.replace(/ON "market_entries"/, `ON "${SHADOW}"`);

  /*
   * Both substitutions MUST have bitten. A DDL string that stopped matching either pattern would
   * otherwise build an index with the live table's own index name, on the live table, in the middle
   * of a rebuild — which is the exact forty-minute exclusive lock this rewrite exists to remove.
   */
  if (renamed === ddl || retargeted === renamed) {
    throw new Error(`market rebuild: index DDL does not match the expected shape:\n${ddl}`);
  }
  return retargeted;
}

/**
 * How much smaller than the table it replaces the rebuild is allowed to be before it is refused.
 *
 * ★ A BAD DUMP MUST NOT BE ABLE TO EMPTY THE MARKET ★
 *
 * The old shape truncated first and asked questions never — a dump that downloaded as a truncated
 * file would have replaced eighteen million rows with whatever it contained, and the first anybody
 * would know is the Freight Office returning nothing. Building beside the live table means the
 * result can be inspected BEFORE it is adopted, and a result this far below the table it would
 * replace is refused: the shadow is dropped, the live table is untouched, and the run fails loudly
 * enough to alert.
 */
const MIN_ACCEPTABLE_FRACTION = 0.5;

/** The live-row merge, run against whichever table is currently the target. */
function mergeLiveRows(from: string, into: string): string[] {
  return [
    `CREATE TEMP TABLE live_keep ON COMMIT DROP AS
       SELECT * FROM ${from} WHERE source <> 'dump'`,
    /*
     * The rule is per STATION, and it is "keep whichever observation is newer" — not "keep
     * everything live". A live row from March loses to a dump row from yesterday, exactly as it
     * should: provenance says where a row came from, the timestamp says whether it still wins.
     *
     * Whole-station, because every writer here replaces whole stations, and mixing a dump row with
     * a live row for one station would resurrect exactly the stopped-trading commodities the
     * replace semantics exist to kill.
     */
    `CREATE TEMP TABLE keep_stations ON COMMIT DROP AS
       SELECT lk.station_key
         FROM (SELECT station_key, max(market_seen_at) AS live_max
                 FROM live_keep GROUP BY station_key) lk
         LEFT JOIN (SELECT station_key, max(market_seen_at) AS dump_max
                      FROM ${into}
                     WHERE station_key IN (SELECT DISTINCT station_key FROM live_keep)
                     GROUP BY station_key) dk USING (station_key)
        WHERE dk.dump_max IS NULL OR lk.live_max > dk.dump_max`,
    `DELETE FROM ${into}
      WHERE station_key IN (SELECT station_key FROM keep_stations)`,
    `INSERT INTO ${into} (${CARRIED})
       SELECT ${CARRIED} FROM live_keep
        WHERE station_key IN (SELECT station_key FROM keep_stations)`,
  ];
}

export async function rebuildMarketEntries(db: PrismaClient): Promise<number> {
  /*
   * A shadow left behind by a run that died mid-flight. Dropping it is safe precisely because
   * nothing reads it — it is never the table members query, at any point in this function.
   */
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${SHADOW}`);

  /*
   * INCLUDING DEFAULTS carries the `nextval('market_entries_id_seq')` default across, so both
   * tables draw from one sequence while the shadow is being built and the swap does not have to
   * invent an identity. Indexes and the primary key are deliberately NOT copied: they are built
   * after the bulk load, which is the entire point of the shape.
   */
  await db.$executeRawUnsafe(`CREATE TABLE ${SHADOW} (LIKE market_entries INCLUDING DEFAULTS)`);

  const written = await db.$executeRawUnsafe(`
    INSERT INTO ${SHADOW} (
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
     * Needed by the WHERE clause below. As a correlated subquery per commodity it would re-scan
     * the station's whole market for every one of its ~100 rows; as a lateral it is one extra
     * pass per station.
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
       * Measured on 400 Coriolis starports: 43,220 such rows against 42,687 real ones, all still
       * carrying a reference price. Keeping them would roughly DOUBLE this table with rows no
       * query can ever usefully return — you cannot buy what has no stock.
       *
       * On a SPACE CONSTRUCTION DEPOT, every commodity reports 0/0 while carrying real buy and
       * sell prices. Zero there is "not reported", not "none in stock" — and the first version of
       * this filter therefore excluded all 36,950 of them. The squadron owner had asked for
       * construction sites explicitly, and the table looked complete: eighteen million rows and
       * every other station type in it.
       *
       * So the rule is per STATION rather than per row. A station that reports a quantity anywhere
       * is believed about its zeros; a station that reports none anywhere is one whose quantities
       * are simply absent, and its priced rows are kept.
       */
      AND (
        COALESCE((c->>'supply')::int, 0) > 0
        OR COALESCE((c->>'demand')::int, 0) > 0
        OR (q.max_qty = 0
            AND (COALESCE((c->>'buyPrice')::int, 0) > 0
                 OR COALESCE((c->>'sellPrice')::int, 0) > 0))
      )
  `);

  const [existing] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM market_entries WHERE source = 'dump'`,
  );
  const before = Number(existing?.n ?? 0n);

  if (before > 0 && written < before * MIN_ACCEPTABLE_FRACTION) {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${SHADOW}`);
    throw new Error(
      `market rebuild refused: the dump produced ${written.toLocaleString()} rows against ` +
        `${before.toLocaleString()} already published. The live table has been left alone. ` +
        `A dump this much smaller is a truncated download far more often than it is real news.`,
    );
  }

  /*
   * ★ THE LIVE ROWS, MERGED BEFORE THE INDEXES EXIST ★
   *
   * Measured 2026-08-04: EDDN wrote 398,877 market rows between 04:59 and 06:21; after the 06:39
   * rebuild the table contained ZERO of them. The dump's own freshest row is over a day old at the
   * moment it lands (its median station age is 118 days), so every rebuild replaced live data with
   * older data, wholesale, and the "real time" market the owner asked for could never exist for
   * longer than the gap between two rebuilds.
   *
   * Reading the live table here takes ACCESS SHARE, which blocks nobody. Cheap, too — the snapshot
   * measured 2.1s against 905,279 live rows, so preserving them is not what made the old
   * transaction long and giving them up would have bought nothing.
   */
  await db.$transaction(
    async (tx) => {
      for (const statement of mergeLiveRows('market_entries', SHADOW)) {
        await tx.$executeRawUnsafe(statement);
      }
    },
    { timeout: 30 * 60_000, maxWait: 60_000 },
  );

  for (const ddl of INDEX_DDL) {
    await db.$executeRawUnsafe(onShadow(ddl));
  }
  await db.$executeRawUnsafe(
    `ALTER TABLE ${SHADOW} ADD CONSTRAINT market_entries_pkey_next PRIMARY KEY (id)`,
  );

  /*
   * ★ ANALYZE BEFORE THE SWAP, NOT AFTER ★
   *
   * Measured in production on 2026-08-06: Postgres believed `market_entries` held 30,281 rows. It
   * held 18,847,651, and `pg_stat_user_tables` reported `last_analyze = never`. Every plan touching
   * the largest table in the database was costed from a number six hundred times too small, so
   * "cheapest source of this commodity within 100 ly" took seventy to one hundred and fifteen
   * seconds and returned nothing — the planner chose a KNN walk over the coords index with
   * `commodity` as a post-filter and crawled the galaxy discarding rows.
   *
   * The old shape had an ANALYZE and it still happened, because it ran inside the transaction that
   * had truncated the table: planner statistics are transactional, the cumulative counters that
   * autovacuum reads are not, and a TRUNCATE that later rolled back left them describing a table
   * that no longer existed.
   *
   * Here there is no such trap. The shadow is analysed while it is still a private table, so the
   * moment it becomes `market_entries` it already has statistics — there is no window at all in
   * which the live table is both queryable and unanalysed.
   */
  await db.$executeRawUnsafe(`ANALYZE ${SHADOW}`);

  /*
   * ★ THE SWAP: CATALOGUE UPDATES ONLY ★
   *
   * Every statement here is metadata. No row is read, written or copied, so the exclusive lock on
   * `market_entries` lasts for the length of eighteen catalogue writes rather than the forty
   * minutes of work that produced them.
   *
   * The old indexes are renamed out of the way first because index names are unique per schema and
   * the outgoing table still holds them until it is dropped.
   */
  await db.$transaction(
    async (tx) => {
      for (const name of INDEXES) {
        await tx.$executeRawUnsafe(`ALTER INDEX "${name}" RENAME TO "${name}_old"`);
      }
      await tx.$executeRawUnsafe(
        `ALTER INDEX "market_entries_pkey" RENAME TO "market_entries_pkey_old"`,
      );

      await tx.$executeRawUnsafe(`ALTER TABLE market_entries RENAME TO ${RETIRED}`);
      await tx.$executeRawUnsafe(`ALTER TABLE ${SHADOW} RENAME TO market_entries`);

      /*
       * The sequence still belongs to the outgoing table's id column, and dropping that table would
       * take the sequence with it — leaving the new `market_entries` with a default referring to
       * something that no longer exists, and every later insert failing. Re-pointing ownership is
       * what makes the drop below safe.
       */
      await tx.$executeRawUnsafe(
        `ALTER SEQUENCE market_entries_id_seq OWNED BY market_entries.id`,
      );

      for (const name of INDEXES) {
        await tx.$executeRawUnsafe(`ALTER INDEX "${name}_next" RENAME TO "${name}"`);
      }
      await tx.$executeRawUnsafe(
        `ALTER INDEX "market_entries_pkey_next" RENAME TO "market_entries_pkey"`,
      );
    },
    { timeout: 60_000, maxWait: 60_000 },
  );

  /*
   * ★ THE ROWS THAT LANDED WHILE THE INDEXES WERE BUILDING ★
   *
   * The live rows were merged before the index phase, which on 2026-08-09 ran for sixteen minutes.
   * Everything EDDN and the journal feeds wrote during those minutes went into the table that has
   * just been retired, and dropping it now would repeat the very data massacre the merge exists to
   * prevent — quieter than before, because it would only ever be the last few minutes.
   *
   * So the same merge runs once more, from the retired table into the live one. It is ordinary DML
   * taking ROW EXCLUSIVE, so it blocks no reader, and it is safely repeatable: a station whose live
   * rows were already carried across now compares equal rather than newer, and is skipped.
   */
  await db.$transaction(
    async (tx) => {
      for (const statement of mergeLiveRows(RETIRED, 'market_entries')) {
        await tx.$executeRawUnsafe(statement);
      }
    },
    { timeout: 30 * 60_000, maxWait: 60_000 },
  );

  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${RETIRED}`);

  return written;
}
