/**
 * One hour of the galaxy's trade, per commodity — the series behind "price over time".
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a real time commodities market ... that shows all the comoditiy details, average pricing, price
 * over time lots of data". Asked how to handle charts when the history table had never once been
 * written to, the owner chose: start recording now and let them fill.
 *
 * ★ WHY A ROLLUP AND NOT EVERY PRICE ★
 *
 * EDDN delivers about 140,000 prices every fifteen minutes. A row per price is 13.4 MILLION a day
 * and roughly 1.2 BILLION inside the ninety-day retention already configured on `market_history` —
 * and no page would ever read a per-station series for 239,265 stations. Rolled up per commodity per
 * hour it is 398 rows an hour, and it answers the question that was actually asked.
 *
 * ★ WHY ONE COMMODITY AT A TIME, WHICH LOOKS LIKE THE SLOW WAY ★
 *
 * It is the fast way, by two orders of magnitude, and this was measured rather than assumed.
 * `market_entries` has no plain index on `commodity` — it has two PARTIAL indexes covering exactly
 * the rows that can be traded (`supply > 0 AND buy_price > 0`, and the demand side). A grouped scan
 * over the whole 18.8-million-row table cannot use either and took SEVENTY-TWO SECONDS for a single
 * commodity's count. The same aggregate riding the partial index takes ~250ms.
 *
 * So: 398 commodities × two legs × ~250ms is a few minutes an hour, entirely on indexes, competing
 * with nothing. The one big GROUP BY is the version that falls over.
 */

/** What one commodity's hour looks like, once both legs have been read. */
export interface CommodityHour {
  readonly commodity: string;
  /** Stations only. Null when nowhere stocked it. */
  readonly avgBuy: number | null;
  readonly minBuy: number | null;
  /** Stations only. Null when nowhere wanted it. */
  readonly avgSell: number | null;
  readonly maxSell: number | null;
  readonly supply: bigint;
  readonly demand: bigint;
  readonly buyMarkets: number;
  readonly sellMarkets: number;
  readonly carrierMinBuy: number | null;
  readonly carrierMaxSell: number | null;
  readonly carrierMarkets: number;
}

/** The buy side of one commodity, as the database answers it. */
export interface BuyLeg {
  readonly avgBuy: number | null;
  readonly minBuy: number | null;
  readonly supply: bigint;
  readonly markets: number;
  readonly carrierMinBuy: number | null;
  readonly carrierMarkets: number;
}

/** The sell side of one commodity. */
export interface SellLeg {
  readonly avgSell: number | null;
  readonly maxSell: number | null;
  readonly demand: bigint;
  readonly markets: number;
  readonly carrierMaxSell: number | null;
  readonly carrierMarkets: number;
}

export interface RollupStore {
  /** Every commodity we hold a tradeable row for. */
  commodities(): Promise<readonly string[]>;
  buyLeg(commodity: string): Promise<BuyLeg>;
  sellLeg(commodity: string): Promise<SellLeg>;
  /** Writes the hour. Idempotent — re-running within the same hour replaces it. */
  write(observedAt: Date, hours: readonly CommodityHour[]): Promise<void>;
}

/**
 * The hour a reading belongs to.
 *
 * ★ TRUNCATED, SO A RERUN CANNOT FORK THE SERIES ★
 *
 * The job is hourly, but it is also startable by hand and retryable by cron after a failure. Using
 * the wall clock would file 14:03 and 14:41 as two different points, and a chart would show the
 * same hour twice with a step between them that no market made. Truncating means a second run
 * OVERWRITES the first — the primary key is (commodity, observed_at) — so the series has exactly one
 * point per hour however many times the job ran.
 */
export function hourOf(now: Date): Date {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export interface RollupReport {
  readonly observedAt: Date;
  readonly commodities: number;
  /** Commodities that had no tradeable market at all this hour. Recorded, not skipped — see below. */
  readonly untraded: number;
  readonly failed: number;
}

/**
 * Reads every commodity and writes the hour.
 *
 * Batched writes rather than one per commodity: 398 round trips to save one is the wrong trade, and
 * the whole hour landing atomically means a chart can never read a half-written point.
 */
export async function rollUpCommodities(
  store: RollupStore,
  now: Date,
  onProgress?: (done: number, total: number) => void,
): Promise<RollupReport> {
  const observedAt = hourOf(now);
  const commodities = await store.commodities();

  const hours: CommodityHour[] = [];
  let failed = 0;
  let untraded = 0;

  for (const [i, commodity] of commodities.entries()) {
    let buy: BuyLeg;
    let sell: SellLeg;
    try {
      /*
       * Sequential, not `Promise.all`. The two legs use DIFFERENT partial indexes over the same
       * large table, and running 796 of them concurrently is how a scheduled job becomes the reason
       * the site is slow. Nothing is waiting on this — it has an hour.
       */
      buy = await store.buyLeg(commodity);
      sell = await store.sellLeg(commodity);
    } catch {
      /*
       * One commodity failed. Counted and skipped, because the alternative is losing the whole hour
       * for all 398 over one of them — and a gap in a chart is worse than a gap in one line of it.
       */
      failed += 1;
      continue;
    }

    if (buy.markets === 0 && sell.markets === 0 && buy.carrierMarkets === 0 && sell.carrierMarkets === 0) {
      /*
       * ★ RECORDED AS A ZERO ROW, NOT OMITTED ★
       *
       * Nothing traded it this hour. Skipping the row would make the gap indistinguishable from the
       * job not having run, and a chart would draw a straight line across it — claiming a price
       * held steady through an hour when in truth nobody was trading it at all.
       */
      untraded += 1;
    }

    hours.push({
      commodity,
      avgBuy: buy.avgBuy,
      minBuy: buy.minBuy,
      avgSell: sell.avgSell,
      maxSell: sell.maxSell,
      supply: buy.supply,
      demand: sell.demand,
      buyMarkets: buy.markets,
      sellMarkets: sell.markets,
      carrierMinBuy: buy.carrierMinBuy,
      carrierMaxSell: sell.carrierMaxSell,
      // Either leg may have seen carriers; the count is of carrier ROWS touched, so the larger is
      // the honest figure rather than the sum, which would double-count a carrier that both buys
      // and sells the same commodity.
      carrierMarkets: Math.max(buy.carrierMarkets, sell.carrierMarkets),
    });

    onProgress?.(i + 1, commodities.length);
  }

  await store.write(observedAt, hours);

  return { observedAt, commodities: hours.length, untraded, failed };
}
