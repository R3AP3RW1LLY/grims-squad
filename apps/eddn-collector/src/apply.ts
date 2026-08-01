import type { PrismaClient } from '@grims/db';
import type { EddnMarket } from './message.js';
import type { CommodityNames } from './names.js';
import type { StationCache } from './stations.js';

/**
 * Writing one EDDN market snapshot into `market_entries`.
 *
 * ★ REPLACE, DO NOT MERGE ★
 *
 * The message lists everything the station trades right now. A commodity present in our table and
 * absent from the message is one the station has STOPPED trading, and merging would leave that row
 * behind for ever — routing a member across the bubble to sell a hold of something nobody there
 * buys. The same reasoning as the journal `Market` event, for the same reason.
 *
 * ★ ONE TRANSACTION, BECAUSE THE GAP IS VISIBLE ★
 *
 * Between the DELETE and the INSERT the station trades nothing. A route query running in that
 * window would not get a stale answer, it would get a WRONG one. Wrapped, so no reader ever sees
 * the empty state.
 */

export interface ApplyResult {
  /** Rows written. Zero when the station is unknown or nothing resolved. */
  readonly rows: number;
  /**
   * Rows the replace dropped and did not put back — commodities this station has STOPPED trading.
   *
   * ★ THE NUMBER THAT SHOWS THE FEED IS EARNING ITS KEEP ★
   *
   * Reported as the net loss, not as the raw DELETE count. The delete removes everything and the
   * insert puts most of it back, so the raw count is roughly equal to the rows written and says
   * nothing. The difference is the interesting part: a station that has stopped buying something is
   * a stale row that would otherwise route a member across the bubble with a hold nobody wants.
   */
  readonly removed: number;
  /** True when we hold no station for this marketId — normal, and counted separately. */
  readonly unknownStation: boolean;
  /** Commodity symbols in this message we could not place. */
  readonly unresolved: number;
}

const NOTHING: ApplyResult = { rows: 0, removed: 0, unknownStation: false, unresolved: 0 };

export async function applyMarket(
  db: PrismaClient,
  market: EddnMarket,
  names: CommodityNames,
  stations: StationCache,
): Promise<ApplyResult> {
  const station = await stations.lookup(db, market.marketId);
  /*
   * Resolved BEFORE any name work: an unknown station means nothing can be written whatever the
   * commodities say, and doing it the other way round would burn the name lookups for the many
   * carriers and construction sites we do not hold.
   */
  if (station === null) return { ...NOTHING, unknownStation: true };

  let unresolved = 0;
  const rows: Array<{
    name: string;
    category: string | null;
    buy: number;
    sell: number;
    supply: number;
    demand: number;
  }> = [];

  for (const c of market.commodities) {
    const known = names.resolve(c.symbol);
    if (known === null) {
      unresolved += 1;
      continue;
    }
    rows.push({
      name: known.name,
      category: known.category,
      buy: c.buyPrice,
      sell: c.sellPrice,
      supply: c.stock,
      demand: c.demand,
    });
  }

  /*
   * Nothing resolved, so nothing is written — and critically, the DELETE does not run either. A
   * message whose commodities we cannot name tells us nothing about what the station trades, and
   * emptying its rows on that basis would replace good data with none.
   */
  if (rows.length === 0) return { ...NOTHING, unresolved };

  const deleted = await db.$transaction(async (tx) => {
    /*
     * ★ FAIL FAST RATHER THAN QUEUE — MEASURED THE HARD WAY, 2026-08-01 ★
     *
     * The nightly `rebuildMarketEntries` TRUNCATEs this table inside a transaction budgeted at
     * THIRTY MINUTES. TRUNCATE takes ACCESS EXCLUSIVE, so for the length of that rebuild every
     * statement here blocks — and the feed does not stop arriving while they do.
     *
     * Observed during development, against a rebuild that was genuinely running: one DELETE blocked
     * for 1,032 seconds and four name queries stacked up behind it, one per restart attempt, each
     * holding a connection. The collector was not slow; it was accumulating.
     *
     * `lock_timeout` turns that into an immediate error, which `ingest` counts as a failure and
     * drops. Losing live updates for the length of a rebuild costs nothing at all: the rebuild is
     * replacing every row in the table from the dump, so anything written during it would be
     * discarded seconds later anyway.
     *
     * `statement_timeout` covers the other shape of the same problem — a statement that acquired
     * its lock and is merely competing for I/O with a bulk load.
     *
     * SET LOCAL, so both revert when the transaction ends and never leak onto a pooled connection.
     */
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '20s'`);

    const dropped = await tx.$executeRawUnsafe(
      `DELETE FROM market_entries WHERE station_key = $1`,
      station.key,
    );

    const values: string[] = [];
    const params: unknown[] = [
      station.key,
      station.name,
      station.system,
      station.type,
      station.pads,
      /*
       * The uploader's observation time when it is plausible, ours when it is not. This column is
       * how a member judges whether to trust a price, so it must never be optimistic — see
       * `asDate` in message.ts.
       */
      market.observedAt ?? new Date(),
    ];

    for (const r of rows) {
      const i = params.length;
      params.push(r.name, r.category, r.buy, r.sell, r.supply, r.demand);
      values.push(
        `($1,$2,$3,$4,` +
          /*
           * Coordinates come from the station's own knowledge row. EDDN does not carry them, and a
           * NULL here would drop the station out of every "within N light years" search — the
           * station would still be in the table and simply stop being found, which is the kind of
           * failure nobody reports because nothing looks broken.
           */
          `(SELECT coords FROM knowledge_items WHERE source='galaxy' AND kind='station' AND ext_key=$1),` +
          `$5,$${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6},$6)`,
      );
    }

    await tx.$executeRawUnsafe(
      `INSERT INTO market_entries (station_key, station_name, system_name, station_type, coords,
                                   large_pads, commodity, category, buy_price, sell_price,
                                   supply, demand, market_seen_at)
       VALUES ${values.join(',')}`,
      ...params,
    );

    return dropped;
    /*
     * The interactive-transaction budget has to clear the two timeouts above, or Prisma aborts
     * first and the lock_timeout never gets the chance to produce the error we are counting on.
     */
  }, { timeout: 30_000 });

  return {
    rows: rows.length,
    // Net, and floored at zero: a station that ADDED commodities has a negative difference, which
    // is not "minus three removed" — it is none removed and three new.
    removed: Math.max(0, deleted - rows.length),
    unknownStation: false,
    unresolved,
  };
}
