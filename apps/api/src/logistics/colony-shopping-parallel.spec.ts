import { describe, expect, it, vi } from 'vitest';
import { ColonyService } from './colony.service.js';
import type { MarketStore } from './market.store.js';

/**
 * The shopping list stops asking one commodity at a time.
 *
 * ★ MEASURED ON PRODUCTION, 2026-08-06 ★
 *
 * Thirty market lookups at a real origin took 5.8 SECONDS of database time, strictly sequentially:
 * the loop awaited each commodity's pair of queries before starting the next. A 25-commodity build
 * is fifty round trips in single file, and every one of them waits out a network hop it did not
 * need to wait for.
 *
 * ★ WHY BOUNDED AND NOT Promise.all ★
 *
 * The obvious fix is to fire all fifty at once, and it would be a new outage. The API's connection
 * pool is twenty-five, and `shoppingBulkhead` already permits SIX concurrent shopping lists — so
 * unbounded fan-out is six lists times fifty queries against a pool of twenty-five. The list that
 * caused the incident would have become the list that caused the next one.
 *
 * A small bound keeps the total demand below the pool no matter how many lists run at once.
 *
 * ★ WHAT DELIBERATELY DOES NOT CHANGE ★
 *
 * Not one query, not the ranking, not the fallbacks. The shopping list has correctness history —
 * "always prioritize local markets before sending out of system" was a real bug caused by
 * re-sorting rows the query had already narrowed — and this change must not be able to reintroduce
 * it. Same SQL, same order, same results; only the waiting is removed.
 */

interface Need {
  commodity: string;
  remaining: number;
  required: number;
}

/** A service whose market records when each call started and finished. */
function serviceWithTimedMarket(needs: Need[], callMs = 20) {
  const active: number[] = [];
  let running = 0;
  let peak = 0;

  const bestBuys = vi.fn(async (commodity: string) => {
    running += 1;
    peak = Math.max(peak, running);
    active.push(running);
    await new Promise((r) => setTimeout(r, callMs));
    running -= 1;
    return [
      {
        stationName: `Station for ${commodity}`,
        systemName: 'Nervi',
        price: 1_000,
        quantity: 50_000,
        distance: 3,
        seenAt: new Date(),
      },
    ];
  });

  const db = {
    colonyNeed: {
      findMany: vi.fn().mockResolvedValue(needs.map((n) => ({ ...n, observedAt: new Date() }))),
    },
  } as unknown as ConstructorParameters<typeof ColonyService>[0];

  return {
    service: new ColonyService(db, { bestBuys } as unknown as MarketStore, {} as ConstructorParameters<typeof ColonyService>[2]),
    bestBuys,
    peak: () => peak,
  };
}

const ORIGIN = { x: 0, y: 0, z: 0 };

/** A fresh key every call, so the coalescer never serves a cached answer to a test. */
let run = 0;
function freshOpts() {
  run += 1;
  return {
    near: ORIGIN,
    withinLy: 100,
    largePadOnly: false,
    sort: 'local' as const,
    carrierCover: { [`__unique_${run}`]: 0 },
  };
}

describe('the shopping list asks for several commodities at once', () => {
  it('MANDATORY: more than one commodity is in flight at a time', async () => {
    /*
     * The whole point. Sequentially this peaks at two — the cheapest/nearest pair for a single
     * commodity — no matter how many commodities there are.
     */
    const needs = Array.from({ length: 10 }, (_, i) => ({
      commodity: `Commodity ${i}`,
      remaining: 100,
      required: 100,
    }));
    const { service, peak } = serviceWithTimedMarket(needs);

    await service.shoppingList('project-parallel', freshOpts());

    expect(peak(), 'the loop is still strictly sequential — one commodity at a time').toBeGreaterThan(2);
  });

  it('MANDATORY: it is BOUNDED, so it cannot exhaust the connection pool', async () => {
    /*
     * Six concurrent shopping lists are permitted by the bulkhead and the pool is twenty-five.
     * Unbounded fan-out on a 25-commodity build is fifty queries per list; the ceiling here is what
     * keeps six of those below twenty-five.
     */
    const needs = Array.from({ length: 40 }, (_, i) => ({
      commodity: `Commodity ${i}`,
      remaining: 100,
      required: 100,
    }));
    const { service, peak } = serviceWithTimedMarket(needs, 5);

    await service.shoppingList('project-bounded', freshOpts());

    expect(
      peak(),
      `forty commodities put ${peak()} queries in flight at once — six lists of that would drown a pool of 25`,
    ).toBeLessThanOrEqual(8);
  });

  it('MANDATORY: every commodity still gets its answer, in the order asked', async () => {
    /*
     * The risk of concurrency: results arriving out of order. A shopping list whose rows do not
     * match its needs is worse than a slow one — it quotes the wrong station for the wrong
     * commodity, and nothing about the page looks wrong.
     */
    const needs = Array.from({ length: 12 }, (_, i) => ({
      commodity: `Commodity ${i}`,
      remaining: 100,
      required: 100,
    }));
    const { service } = serviceWithTimedMarket(needs, 3);

    const rows = await service.shoppingList('project-order', freshOpts());

    expect(rows.map((r) => r.commodity)).toEqual(needs.map((n) => n.commodity));
    for (const row of rows) {
      expect(row.stationName, `${row.commodity} got another commodity's station`).toBe(
        `Station for ${row.commodity}`,
      );
    }
  });

  it('MANDATORY: a commodity fully covered by carriers still never asks the market', async () => {
    /*
     * Preserved from colony-carrier-cargo.spec. Concurrency makes it easy to hoist the market call
     * above the carrier check for tidiness, and that would quote stations for cargo the squadron
     * already owns — the exact trip the carrier cover exists to prevent.
     */
    const { service, bestBuys } = serviceWithTimedMarket([
      { commodity: 'Steel', remaining: 1_000, required: 1_000 },
    ]);

    const rows = await service.shoppingList('project-covered', {
      ...freshOpts(),
      carrierCover: { Steel: 5_000 },
    });

    expect(bestBuys, 'the market was asked about a commodity the carriers already cover').not.toHaveBeenCalled();
    expect(rows[0]?.toBuy).toBe(0);
    expect(rows[0]?.cost).toBe(0);
  });
});
