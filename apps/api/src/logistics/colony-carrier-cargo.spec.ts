import { describe, expect, it, vi } from 'vitest';
import { carrierCover, effectiveTonnes } from './colony-carrier.service.js';
import { ColonyService } from './colony.service.js';
import type { MarketStore } from './market.store.js';

/**
 * The carrier-cargo merge rule, and what it does to the shopping list.
 *
 * ★ THE TWO RULES WORTH PINNING ★
 *
 *   1. THE MERGE: manual beats journal beats mirror — written on the table
 *      (ssot/03-data/schema.prisma, ColonyCarrierCargo) and enforced here so nobody re-derives it
 *      differently in a component. The subtle half is that a manual ZERO wins too: it is the only
 *      way a crew member can retire a stale claim.
 *
 *   2. THE SUBTRACTION: what the carriers effectively hold is not something to buy. A commodity
 *      fully covered by attached carriers must quote NOTHING — no station, no cost, and no market
 *      query spent finding one — because "go and buy steel the squadron already owns" is exactly
 *      the wasted evening this feature exists to prevent.
 */

describe('effectiveTonnes — the merge rule', () => {
  it('manual wins outright, including over a bigger journal or mirror figure', () => {
    expect(effectiveTonnes({ manual: 100, journal: 5_000, mirror: 20_000 })).toBe(100);
  });

  it('★ a manual ZERO retires a stale claim — it is not "absent" ★', () => {
    // The mirror still shows 20,000 t of a sell order the owner cancelled last week. The crew
    // member standing on the deck says the hold is empty, and the hand beats the archive.
    expect(effectiveTonnes({ manual: 0, journal: 300, mirror: 20_000 })).toBe(0);
  });

  it('without a manual figure, the two floors argue by size', () => {
    // Journal misses whatever moved while the app was closed; the mirror sees only sell orders.
    // Both understate, so the larger of two floors is the better floor.
    expect(effectiveTonnes({ manual: null, journal: 300, mirror: 900 })).toBe(900);
    expect(effectiveTonnes({ manual: null, journal: 1_200, mirror: 900 })).toBe(1_200);
    expect(effectiveTonnes({ manual: null, journal: null, mirror: 900 })).toBe(900);
    expect(effectiveTonnes({ manual: null, journal: null, mirror: null })).toBe(0);
  });
});

describe('carrierCover — summing across the attached carriers', () => {
  it('applies the merge per carrier, then adds the carriers up', () => {
    const at = new Date();
    const cover = carrierCover([
      {
        holds: [{ commodity: 'Steel', tonnes: 500, seenAt: at }],
        declared: [
          { commodity: 'Steel', tonnes: 800, source: 'journal', updatedBy: null, updatedAt: at },
        ],
      },
      {
        holds: [],
        declared: [
          { commodity: 'Steel', tonnes: 200, source: 'manual', updatedBy: 'Grim', updatedAt: at },
          { commodity: 'Titanium', tonnes: 40, source: 'journal', updatedBy: null, updatedAt: at },
        ],
      },
    ]);

    // Carrier one: max(journal 800, mirror 500) = 800. Carrier two: manual 200 wins. Sum 1,000.
    expect(cover['Steel']).toBe(1_000);
    expect(cover['Titanium']).toBe(40);
  });

  it('a manual zero on one carrier does not erase another carrier’s stock', () => {
    const at = new Date();
    const cover = carrierCover([
      {
        holds: [{ commodity: 'Steel', tonnes: 500, seenAt: at }],
        declared: [
          { commodity: 'Steel', tonnes: 0, source: 'manual', updatedBy: 'Grim', updatedAt: at },
        ],
      },
      { holds: [{ commodity: 'Steel', tonnes: 300, seenAt: at }], declared: [] },
    ]);
    expect(cover['Steel']).toBe(300);
  });
});

describe('the shopping list subtracts the carriers', () => {
  function serviceFor(
    needs: Array<{ commodity: string; remaining: number; required: number | null }>,
  ) {
    const bestBuys = vi.fn().mockResolvedValue([
      {
        stationName: 'Vista Ring',
        systemName: 'Nervi',
        price: 1_000,
        quantity: 50_000,
        distance: 3,
        seenAt: new Date(),
      },
    ]);

    const db = {
      colonyNeed: {
        findMany: vi
          .fn()
          .mockResolvedValue(needs.map((n) => ({ ...n, observedAt: new Date() }))),
      },
    } as unknown as ConstructorParameters<typeof ColonyService>[0];
    const market = { bestBuys } as unknown as MarketStore;
    const acl = {} as ConstructorParameters<typeof ColonyService>[2];

    return { service: new ColonyService(db, market, acl), bestBuys };
  }

  it('★ a commodity fully covered by carriers quotes ZERO to buy — and never asks the market ★', async () => {
    const { service, bestBuys } = serviceFor([
      { commodity: 'Steel', remaining: 4_000, required: 10_000 },
    ]);

    const rows = await service.shoppingList('p1', {
      near: { x: 0, y: 0, z: 0 },
      withinLy: 100,
      largePadOnly: false,
      carrierCover: { Steel: 9_999 },
    });

    expect(rows).toHaveLength(1);
    const steel = rows[0]!;
    expect(steel.onCarriers).toBe(4_000); // capped at the remaining need, not the whole hold
    expect(steel.toBuy).toBe(0);
    expect(steel.stationName).toBeNull();
    // Zero, not null: null means "nowhere sells it", and this line needs nothing bought.
    expect(steel.cost).toBe(0);
    expect(bestBuys).not.toHaveBeenCalled();
  });

  it('a partly covered commodity is quoted for the SHORTFALL, not the whole need', async () => {
    const { service, bestBuys } = serviceFor([
      { commodity: 'Steel', remaining: 4_000, required: 10_000 },
    ]);

    const rows = await service.shoppingList('p1', {
      near: { x: 0, y: 0, z: 0 },
      withinLy: 100,
      largePadOnly: false,
      carrierCover: { Steel: 1_500 },
    });

    const steel = rows[0]!;
    expect(steel.onCarriers).toBe(1_500);
    expect(steel.toBuy).toBe(2_500);
    // Cost prices what still needs BUYING — 2,500 t at 1,000 cr — not the full 4,000.
    expect(steel.cost).toBe(2_500_000);
    expect(bestBuys).toHaveBeenCalled();
  });

  it('no cover means the old answer exactly: the full remaining tonnage is quoted', async () => {
    const { service } = serviceFor([{ commodity: 'Steel', remaining: 4_000, required: null }]);

    const rows = await service.shoppingList('p1', {
      near: { x: 0, y: 0, z: 0 },
      withinLy: 100,
      largePadOnly: false,
    });

    const steel = rows[0]!;
    expect(steel.onCarriers).toBe(0);
    expect(steel.toBuy).toBe(4_000);
    expect(steel.cost).toBe(4_000_000);
  });
});
