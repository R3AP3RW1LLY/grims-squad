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
      return tx.$executeRawUnsafe(`
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
        CROSS JOIN LATERAL jsonb_array_elements(k.data->'market') c
        WHERE k.source = 'galaxy'
          AND k.kind = 'station'
          AND jsonb_typeof(k.data->'market') = 'array'
          /*
           * Rows the station neither buys nor sells are skipped. Roughly half of every market is a
           * commodity it does not trade, and they can never be returned by any query — indexing
           * them would double the table for nothing.
           */
          AND (COALESCE((c->>'supply')::int, 0) > 0 OR COALESCE((c->>'demand')::int, 0) > 0)
      `);
    },
    // The galaxy is tens of millions of rows; the default 5s transaction timeout is nowhere near.
    { timeout: 30 * 60_000, maxWait: 60_000 },
  );
}
