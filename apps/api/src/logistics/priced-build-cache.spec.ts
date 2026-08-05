import { describe, expect, it, vi, afterEach } from 'vitest';
import { ColonyCatalogueService } from './colony-catalogue.service.js';
import type { PrismaClient } from '@grims/db';
import type { MarketStore } from './market.store.js';

/**
 * The priced shopping list is computed once a minute, not once a poll.
 *
 * ★ REPORTED 2026-08-05 ★
 *
 * Members saw "The hub did not answer in time" from the companion app. The hub WAS answering — in
 * three to seven seconds — and every slow request was the same one: a project's priced shopping
 * list, twenty market lookups against 18.8 million rows.
 *
 * Nothing about the query was wrong. The volume was. The companion polls a project page every
 * sixty seconds, so five members watching one build is a hundred of those lookups a minute, all
 * returning the same answer: prices move on the EDDN relay's pace, not between two polls.
 *
 * ★ WHY THE KEY IS ROUNDED ★
 *
 * "Cheapest near me" is a different answer per member, so the origin is part of the key — but a
 * member drifting in supercruise moves a few hundred metres between polls. Keyed on raw
 * coordinates the cache would miss every single time while appearing to work, which costs memory
 * and saves nothing.
 */

const HEAD = {
  id: 'coriolis',
  display_name: 'Coriolis Starport',
  category: 'starport',
  tier: 2,
  location: 'orbital',
  pad_size: 'large',
  total_tonnes: 54_000,
  layouts: [],
  source: 'community',
  confirmations: 0,
};

/** Counts how many times the market was actually asked. That count IS the assertion. */
function serviceWithCounter() {
  let marketCalls = 0;

  const db = {
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes('FROM colony_build_types')) return [HEAD];
      if (sql.includes('FROM colony_build_costs')) return [{ commodity: 'Titanium', tonnes: 100 }];
      return [];
    },
  } as unknown as PrismaClient;

  const market = {
    bestBuys: async () => {
      marketCalls += 1;
      return [
        {
          stationName: 'Jameson Memorial',
          systemName: 'Shinrarta Dezhra',
          price: 1000,
          distance: 12,
        },
      ];
    },
  } as unknown as MarketStore;

  return { service: new ColonyCatalogueService(db, market), calls: () => marketCalls };
}

const NEAR = { x: 100, y: 200, z: 300 };

afterEach(() => {
  vi.useRealTimers();
});

describe('pricing a build', () => {
  it('MANDATORY: a second identical request does not hit the market again', async () => {
    /*
     * The whole fix. Two polls a few seconds apart — which is what five members with the page open
     * actually produce — must cost one set of lookups, not two.
     */
    const { service, calls } = serviceWithCounter();

    await service.byId('coriolis', NEAR);
    const afterFirst = calls();
    await service.byId('coriolis', NEAR);

    expect(afterFirst).toBeGreaterThan(0);
    expect(calls()).toBe(afterFirst);
  });

  it('MANDATORY: a different origin is a different answer, and is not served from the cache', async () => {
    /*
     * "Cheapest near me" is per member. Serving somebody in Sol a price computed for somebody in
     * Colonia is the one number this page must never invent.
     */
    const { service, calls } = serviceWithCounter();

    await service.byId('coriolis', NEAR);
    const afterFirst = calls();
    await service.byId('coriolis', { x: -900, y: 40, z: 12_000 });

    expect(calls()).toBeGreaterThan(afterFirst);
  });

  it('a member drifting a few hundred metres still hits the cache', async () => {
    // Rounded to whole light years. Without this the cache would miss on every poll while looking
    // like it worked.
    const { service, calls } = serviceWithCounter();

    await service.byId('coriolis', NEAR);
    const afterFirst = calls();
    await service.byId('coriolis', { x: 100.4, y: 199.8, z: 300.2 });

    expect(calls()).toBe(afterFirst);
  });

  it('MANDATORY: it goes stale, so prices cannot freeze', async () => {
    vi.useFakeTimers();
    const { service, calls } = serviceWithCounter();

    await service.byId('coriolis', NEAR);
    const afterFirst = calls();

    vi.advanceTimersByTime(61_000);
    await service.byId('coriolis', NEAR);

    expect(calls()).toBeGreaterThan(afterFirst);
  });

  it('a different build is not confused with this one', async () => {
    const { service, calls } = serviceWithCounter();

    await service.byId('coriolis', NEAR);
    const afterFirst = calls();
    await service.byId('outpost', NEAR);

    expect(calls()).toBeGreaterThan(afterFirst);
  });
});
