import type { PrismaClient } from '@grims/db';
import type { BuyLeg, CommodityHour, RollupStore, SellLeg } from './commodity-rollup.js';

/**
 * Reading the hour out of `market_entries`, and writing it into `commodity_snapshots`.
 *
 * Everything here is shaped by one fact about that table: it has NO plain index on `commodity`. It
 * has two partial indexes covering exactly the rows that can be traded —
 *
 *   market_entries_buy_idx   (commodity, buy_price ASC)   WHERE supply > 0 AND buy_price > 0
 *   market_entries_sell_idx  (commodity, sell_price DESC) WHERE demand > 0 AND sell_price > 0
 *
 * — and every query below is written to ride one of them. The measured difference is not marginal:
 * a `count(*)` for one commodity that cannot use them took 72,570ms; the same aggregate that can
 * takes ~250ms.
 */

/** Carrier prices are set by hand, so they are counted apart from the market. See the model note. */
const CARRIER_TYPE = 'Drake-Class Carrier';

/**
 * Every commodity anybody is trading, by LOOSE INDEX SCAN.
 *
 * ★ THE OBVIOUS QUERY IS THE EXPENSIVE ONE ★
 *
 * `SELECT DISTINCT commodity FROM market_entries` has to read all 18.8 million rows — Postgres has
 * no index skip scan, so a distinct on a low-cardinality leading column degrades to a full scan.
 * The collector does exactly that once an hour and budgets sixty seconds for it.
 *
 * This walks the partial index instead: take the first commodity, then repeatedly ask for the
 * smallest one greater than the last. Each step is a single index descent, so 398 commodities is
 * 398 cheap lookups rather than one enormous scan. Measured on our own data: 35ms and 7ms for the
 * two legs, against the full scan's ten to seventy seconds.
 *
 * Both legs are walked and merged, because a commodity can have demand everywhere and supply
 * nowhere — salvage and rare goods are exactly that, and taking only the buy side would drop them
 * from the market entirely.
 */
function looseScan(where: string): string {
  return `
    WITH RECURSIVE walk AS (
      (SELECT commodity, category
         FROM market_entries
        WHERE ${where}
        ORDER BY commodity
        LIMIT 1)
      UNION ALL
      SELECT next.commodity, next.category
        FROM walk
        CROSS JOIN LATERAL (
          SELECT commodity, category
            FROM market_entries
           WHERE ${where}
             AND commodity > walk.commodity
           ORDER BY commodity
           LIMIT 1
        ) AS next
    )
    SELECT commodity, category FROM walk`;
}

const BUY_WHERE = 'supply > 0 AND buy_price > 0';
const SELL_WHERE = 'demand > 0 AND sell_price > 0';

/** Postgres returns `count`/`sum` as bigint and `avg` as numeric; both arrive as strings or nulls. */
function int(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function big(v: unknown): bigint {
  if (v === null || v === undefined) return 0n;
  try {
    return BigInt(String(v).split('.')[0] ?? '0');
  } catch {
    return 0n;
  }
}

export class PrismaRollupStore implements RollupStore {
  constructor(private readonly db: PrismaClient) {}

  /** Commodity → category, so the snapshot can carry it and the market index needs no join. */
  readonly categories = new Map<string, string | null>();

  async commodities(): Promise<readonly string[]> {
    const legs = await Promise.all([
      this.db.$queryRawUnsafe<Array<{ commodity: string; category: string | null }>>(
        looseScan(BUY_WHERE),
      ),
      this.db.$queryRawUnsafe<Array<{ commodity: string; category: string | null }>>(
        looseScan(SELL_WHERE),
      ),
    ]);

    for (const rows of legs) {
      for (const r of rows) {
        // First non-null wins: the same commodity can carry a null category at one station and a
        // real one at another, and the informative row is the one worth keeping.
        const held = this.categories.get(r.commodity);
        if (held === undefined || held === null) this.categories.set(r.commodity, r.category);
      }
    }

    return [...this.categories.keys()].sort();
  }

  async buyLeg(commodity: string): Promise<BuyLeg> {
    /*
     * `station_type IS DISTINCT FROM` rather than `<>`: a station whose type we have never learned
     * carries NULL, and `<>` would answer NULL for it — dropping every unknown-type station out of
     * the average silently. `IS DISTINCT FROM` treats NULL as "not a carrier", which is the right
     * default given carriers ALWAYS report their type.
     */
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT count(*) FILTER (WHERE station_type IS DISTINCT FROM $2)              AS markets,
              avg(buy_price) FILTER (WHERE station_type IS DISTINCT FROM $2)        AS avg_buy,
              min(buy_price) FILTER (WHERE station_type IS DISTINCT FROM $2)        AS min_buy,
              sum(supply) FILTER (WHERE station_type IS DISTINCT FROM $2)           AS supply,
              count(*) FILTER (WHERE station_type = $2)                             AS carrier_markets,
              min(buy_price) FILTER (WHERE station_type = $2)                       AS carrier_min_buy
         FROM market_entries
        WHERE commodity = $1 AND ${BUY_WHERE}`,
      commodity,
      CARRIER_TYPE,
    );

    const r = rows[0] ?? {};
    return {
      avgBuy: int(r['avg_buy']),
      minBuy: int(r['min_buy']),
      supply: big(r['supply']),
      markets: int(r['markets']) ?? 0,
      carrierMinBuy: int(r['carrier_min_buy']),
      carrierMarkets: int(r['carrier_markets']) ?? 0,
    };
  }

  async sellLeg(commodity: string): Promise<SellLeg> {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT count(*) FILTER (WHERE station_type IS DISTINCT FROM $2)              AS markets,
              avg(sell_price) FILTER (WHERE station_type IS DISTINCT FROM $2)       AS avg_sell,
              max(sell_price) FILTER (WHERE station_type IS DISTINCT FROM $2)       AS max_sell,
              sum(demand) FILTER (WHERE station_type IS DISTINCT FROM $2)           AS demand,
              count(*) FILTER (WHERE station_type = $2)                             AS carrier_markets,
              max(sell_price) FILTER (WHERE station_type = $2)                      AS carrier_max_sell
         FROM market_entries
        WHERE commodity = $1 AND ${SELL_WHERE}`,
      commodity,
      CARRIER_TYPE,
    );

    const r = rows[0] ?? {};
    return {
      avgSell: int(r['avg_sell']),
      maxSell: int(r['max_sell']),
      demand: big(r['demand']),
      markets: int(r['markets']) ?? 0,
      carrierMaxSell: int(r['carrier_max_sell']),
      carrierMarkets: int(r['carrier_markets']) ?? 0,
    };
  }

  async write(observedAt: Date, hours: readonly CommodityHour[]): Promise<void> {
    if (hours.length === 0) return;

    /*
     * One statement for the whole hour. 398 upserts would be 398 round trips to save building one
     * parameter list, and the hour landing atomically means no chart can read a half-written point.
     *
     * ON CONFLICT so a rerun REPLACES rather than fails — the job is startable by hand and retried
     * by cron, and `hourOf` deliberately gives both runs the same key.
     */
    const params: unknown[] = [observedAt];
    const values: string[] = [];

    for (const h of hours) {
      const i = params.length;
      params.push(
        h.commodity,
        this.categories.get(h.commodity) ?? null,
        h.avgBuy,
        h.minBuy,
        h.avgSell,
        h.maxSell,
        // Bound as a string: node-postgres has no bigint binding, and a tonnage above 2^53 would
        // lose precision going through Number. Total supply for a common commodity is already in
        // the billions.
        h.supply.toString(),
        h.demand.toString(),
        h.buyMarkets,
        h.sellMarkets,
        h.carrierMinBuy,
        h.carrierMaxSell,
        h.carrierMarkets,
      );
      values.push(
        `($${i + 1},$1,$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6},` +
          `$${i + 7}::bigint,$${i + 8}::bigint,$${i + 9},$${i + 10},$${i + 11},$${i + 12},$${i + 13})`,
      );
    }

    await this.db.$executeRawUnsafe(
      `INSERT INTO commodity_snapshots
         (commodity, observed_at, category, avg_buy, min_buy, avg_sell, max_sell,
          supply, demand, buy_markets, sell_markets,
          carrier_min_buy, carrier_max_sell, carrier_markets)
       VALUES ${values.join(',')}
       ON CONFLICT (commodity, observed_at) DO UPDATE SET
         category         = EXCLUDED.category,
         avg_buy          = EXCLUDED.avg_buy,
         min_buy          = EXCLUDED.min_buy,
         avg_sell         = EXCLUDED.avg_sell,
         max_sell         = EXCLUDED.max_sell,
         supply           = EXCLUDED.supply,
         demand           = EXCLUDED.demand,
         buy_markets      = EXCLUDED.buy_markets,
         sell_markets     = EXCLUDED.sell_markets,
         carrier_min_buy  = EXCLUDED.carrier_min_buy,
         carrier_max_sell = EXCLUDED.carrier_max_sell,
         carrier_markets  = EXCLUDED.carrier_markets`,
      ...params,
    );
  }
}
