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

/**
 * ★ THE JOURNAL LEADS WHEN IT IS WATCHING — SQUADRON OWNER, 2026-08-17 ★
 *
 * "this is something that should be tracked via both journals and capi depending on if the companion
 * app is seeing the journal entries, the priority must be companion app journal ingestion, if nothing
 * because a member is playing on a cloud service, then it should default to cAPI."
 *
 * That is not a fixed rank — "is the app seeing entries" is a question about TIME. So between the
 * journal and Frontier, whichever spoke most recently wins, and the journal takes ties.
 *
 * The consequence is that nothing has to detect the platform. A member flying with the app open
 * emits journal entries continuously and leads by themselves; a member on a cloud platform emits
 * none, so Frontier's ten-minute poll is always the newer statement and takes over on its own.
 */
const AUG16 = new Date('2026-08-16T00:00:00Z');
const AUG17 = new Date('2026-08-17T00:00:00Z');

describe('effectiveTonnes — the merge rule', () => {
  it('manual wins outright, whatever anything else says or when', () => {
    // The one source that can say "this figure is wrong". Unchanged by the recency rule.
    expect(
      effectiveTonnes({
        manual: 100,
        capi: 9_000,
        capiAt: AUG17,
        journal: 5_000,
        journalAt: AUG17,
        mirror: 20_000,
      }),
    ).toBe(100);
  });

  it('★ a manual ZERO retires a stale claim — it is not "absent" ★', () => {
    expect(
      effectiveTonnes({ manual: 0, capi: null, capiAt: null, journal: 300, journalAt: AUG17, mirror: 20_000 }),
    ).toBe(0);
  });

  describe('the journal and Frontier, decided by who spoke last', () => {
    it('★ MANDATORY: a LIVE journal leads over an older Frontier reading ★', () => {
      /*
       * The priority the owner set. An app watching cargo move is a better account of the hold than
       * a manifest sampled some minutes earlier — it saw the movement rather than its result.
       */
      expect(
        effectiveTonnes({
          manual: null,
          capi: 400,
          capiAt: AUG16,
          journal: 5_000,
          journalAt: AUG17,
          mirror: null,
        }),
      ).toBe(5_000);
    });

    it('★ MANDATORY: with NO journal at all, Frontier answers — the cloud player ★', () => {
      /*
       * A member on a cloud platform cannot run the companion, so no journal row will ever exist for
       * them. This is the case cAPI was brought in for, and it must need no configuration to work.
       */
      expect(
        effectiveTonnes({ manual: null, capi: 800, capiAt: AUG17, journal: null, journalAt: null, mirror: null }),
      ).toBe(800);
    });

    it('★ MANDATORY: a STALE journal loses to a fresher Frontier reading ★', () => {
      /*
       * Measured on production: carrier W8K-W1Y carried eighteen journal rows reading ZERO, written
       * by an app that had not run for two days, while the member's carrier was full. Those zeros
       * must lose the moment Frontier is asked — and win again the moment the app is opened.
       */
      expect(
        effectiveTonnes({
          manual: null,
          capi: 12_400,
          capiAt: AUG17,
          journal: 0,
          journalAt: AUG16,
          mirror: null,
        }),
      ).toBe(12_400);
    });

    it('★ MANDATORY: when Frontier leads, its ZERO empties the hold ★', () => {
      /*
       * The one thing no other source can say. A complete manifest REPLACES the floors rather than
       * arguing with them by size — otherwise a fortnight-old journal or a cancelled sell order goes
       * on promising cargo that was sold days ago.
       */
      expect(
        effectiveTonnes({
          manual: null,
          capi: 0,
          capiAt: AUG17,
          journal: 5_000,
          journalAt: AUG16,
          mirror: 20_000,
        }),
      ).toBe(0);
    });

    it('★ MANDATORY: when the JOURNAL leads it is a floor, not a replacement ★', () => {
      /*
       * The asymmetry is the point. The journal knows what it watched and nothing about what moved
       * while it was closed, so the mirror may legitimately know more — and the larger of two floors
       * is the better floor. Only Frontier's complete manifest earns the right to overrule.
       */
      expect(
        effectiveTonnes({
          manual: null,
          capi: null,
          capiAt: null,
          journal: 300,
          journalAt: AUG17,
          mirror: 900,
        }),
      ).toBe(900);
    });

    it('a tie goes to the journal, and so does a pair with no dates at all', () => {
      // "The app is watching" is the condition asked to lead, so an unclear tie resolves that way.
      // Rows written before this rule existed carry no date and behave the same.
      expect(
        effectiveTonnes({ manual: null, capi: 99, capiAt: AUG17, journal: 5_000, journalAt: AUG17, mirror: null }),
      ).toBe(5_000);
      expect(
        effectiveTonnes({ manual: null, capi: 99, capiAt: null, journal: 5_000, journalAt: null, mirror: null }),
      ).toBe(5_000);
    });
  });

  it('with neither declared source, the mirror stands alone', () => {
    expect(
      effectiveTonnes({ manual: null, capi: null, capiAt: null, journal: null, journalAt: null, mirror: 900 }),
    ).toBe(900);
    expect(
      effectiveTonnes({ manual: null, capi: null, capiAt: null, journal: null, journalAt: null, mirror: null }),
    ).toBe(0);
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
