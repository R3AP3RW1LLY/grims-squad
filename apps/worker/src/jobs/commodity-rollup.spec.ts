import { describe, it, expect } from 'vitest';
import {
  rollUpCommodities,
  hourOf,
  type BuyLeg,
  type CommodityHour,
  type RollupStore,
  type SellLeg,
} from './commodity-rollup.js';

/**
 * The series behind "price over time".
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "average pricing, price over time lots of data" — and, told the history table had never been
 * written to, "start recording now, show charts as they fill".
 *
 * A chart is a claim about the past, and once recorded a wrong point is wrong for ever. So what this
 * suite protects is the honesty of each point: that an hour nobody traded reads as untraded rather
 * than as a steady price, that a rerun cannot fork the series, and that hand-priced fleet carriers
 * never quietly enter the average.
 */

const BUY = (over: Partial<BuyLeg> = {}): BuyLeg => ({
  avgBuy: 44_758,
  minBuy: 3_985,
  supply: 4_513_488_319n,
  markets: 71_920,
  carrierMinBuy: 2_356,
  carrierMarkets: 1_299,
  ...over,
});

const SELL = (over: Partial<SellLeg> = {}): SellLeg => ({
  avgSell: 48_034,
  maxSell: 67_826,
  demand: 900_000n,
  markets: 160_550,
  carrierMaxSell: 4_760_900,
  carrierMarkets: 1_100,
  ...over,
});

function harness(opts: {
  commodities: string[];
  buy?: Record<string, BuyLeg | 'throw'>;
  sell?: Record<string, SellLeg | 'throw'>;
}) {
  const written: Array<{ observedAt: Date; hours: readonly CommodityHour[] }> = [];

  const store: RollupStore = {
    commodities: async () => opts.commodities,
    buyLeg: async (c) => {
      const leg = opts.buy?.[c] ?? BUY();
      if (leg === 'throw') throw new Error('index unavailable');
      return leg;
    },
    sellLeg: async (c) => {
      const leg = opts.sell?.[c] ?? SELL();
      if (leg === 'throw') throw new Error('index unavailable');
      return leg;
    },
    write: async (observedAt, hours) => {
      written.push({ observedAt, hours });
    },
  };

  return { store, written, only: () => written[0]?.hours[0] };
}

describe('the hour a reading belongs to', () => {
  it('MANDATORY: truncates, so a rerun replaces rather than forks the series', () => {
    /*
     * The job is hourly, startable by hand, and retried by cron after a failure. Keyed on the wall
     * clock, 14:03 and 14:41 would be two points in the same hour with a step between them that no
     * market made. Truncated, the second run overwrites the first — the primary key is
     * (commodity, observed_at) — so however many times it ran there is exactly one point.
     */
    const a = hourOf(new Date('2026-08-02T14:03:11.482Z'));
    const b = hourOf(new Date('2026-08-02T14:41:59.999Z'));

    expect(a.toISOString()).toBe('2026-08-02T14:00:00.000Z');
    expect(a.getTime()).toBe(b.getTime());
  });

  it('does not mutate the clock it was handed', () => {
    // It builds the bucket by mutating a Date; doing that to the caller's would move `now` under
    // whatever else in the run still needs it.
    const now = new Date('2026-08-02T14:03:11.482Z');
    hourOf(now);
    expect(now.toISOString()).toBe('2026-08-02T14:03:11.482Z');
  });
});

describe('rolling up an hour', () => {
  it('records both sides, and keeps carriers OUT of the average', async () => {
    /*
     * ★ THE NUMBER THAT MADE THIS A REQUIREMENT ★
     *
     * In our own data the cheapest Gold in the galaxy is a set of fleet carriers at 2,356 against a
     * station average of 44,758, and the dearest is a carrier at 4,760,900. Both are real; both are
     * set by hand by an owner who will jump the carrier away. Averaged in, the figure describes
     * nowhere a member can be sent.
     */
    const h = harness({ commodities: ['Gold'] });

    await rollUpCommodities(h.store, new Date('2026-08-02T14:03:00Z'));

    const gold = h.only();
    expect(gold?.avgBuy).toBe(44_758);
    expect(gold?.avgSell).toBe(48_034);
    // Kept beside the average, not folded into it.
    expect(gold?.carrierMinBuy).toBe(2_356);
    expect(gold?.carrierMaxSell).toBe(4_760_900);
  });

  it('counts carriers once when both legs saw them', async () => {
    // A carrier that both buys and sells Gold is ONE carrier. Summing the legs would report 2,399
    // carriers where there are 1,299, and the count is what tells a member how much of the market
    // they are choosing to ignore.
    const h = harness({ commodities: ['Gold'] });

    await rollUpCommodities(h.store, new Date('2026-08-02T14:00:00Z'));

    expect(h.only()?.carrierMarkets).toBe(1_299);
  });

  it('MANDATORY: an untraded hour is a recorded zero, not a missing row', async () => {
    /*
     * Nobody traded it this hour. Omitting the row makes that indistinguishable from the job having
     * not run, and a chart joins across the gap with a straight line — claiming a price held steady
     * through an hour in which there was no price at all.
     */
    const h = harness({
      commodities: ['Unobtainium'],
      buy: { Unobtainium: BUY({ markets: 0, carrierMarkets: 0, avgBuy: null, minBuy: null, supply: 0n }) },
      sell: { Unobtainium: SELL({ markets: 0, carrierMarkets: 0, avgSell: null, maxSell: null, demand: 0n }) },
    });

    const report = await rollUpCommodities(h.store, new Date('2026-08-02T14:00:00Z'));

    expect(report.untraded).toBe(1);
    expect(h.written[0]?.hours).toHaveLength(1);
    // Null, never zero. Zero is a price; "nobody traded it" is not, and a chart that plots the
    // second as the first shows a crash that never happened.
    expect(h.only()?.avgBuy).toBeNull();
  });

  it('MANDATORY: one failed commodity does not cost the whole hour', async () => {
    /*
     * 398 commodities share a run. Letting one propagate loses the hour for all of them, and a gap
     * in every chart is a far worse outcome than a gap in one line of one.
     */
    const h = harness({ commodities: ['Gold', 'Painite', 'Tritium'], buy: { Painite: 'throw' } });

    const report = await rollUpCommodities(h.store, new Date('2026-08-02T14:00:00Z'));

    expect(report.failed).toBe(1);
    expect(report.commodities).toBe(2);
    expect(h.written[0]?.hours.map((x) => x.commodity)).toEqual(['Gold', 'Tritium']);
  });

  it('writes the whole hour in one call', async () => {
    // Not 398 round trips, and not a partially visible hour.
    const h = harness({ commodities: ['Gold', 'Painite', 'Tritium'] });

    await rollUpCommodities(h.store, new Date('2026-08-02T14:00:00Z'));

    expect(h.written).toHaveLength(1);
    expect(h.written[0]?.hours).toHaveLength(3);
    expect(h.written[0]?.observedAt.toISOString()).toBe('2026-08-02T14:00:00.000Z');
  });
});
