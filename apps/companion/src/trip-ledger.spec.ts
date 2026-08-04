import { describe, expect, it } from 'vitest';
import { EMPTY_TRIP, foldTrip, type TripLedger } from './trip-ledger.js';
import type { ParsedLike } from './docked.js';

/**
 * The second shape of the ledger: per-commodity cost of what is aboard, plus the till receipt.
 * Every rule the owner asked for on 2026-08-04 gets a case — including the ones that CHANGED
 * from the first shape (nothing resets on undock any more), because a surviving old rule is
 * exactly the regression these exist to catch.
 */

const ev = (name: string, data: Record<string, unknown>): ParsedLike => ({
  name,
  data,
  occurredAt: '2026-08-04T12:00:00Z',
});

const buy = (type: string, count: number, total: number): ParsedLike =>
  ev('MarketBuy', { Type: type.toLowerCase(), Type_Localised: type, Count: count, TotalCost: total });

const sell = (type: string, count: number, total: number, avg?: number): ParsedLike =>
  ev('MarketSell', {
    Type: type.toLowerCase(),
    Type_Localised: type,
    Count: count,
    TotalSale: total,
    ...(avg === undefined ? {} : { AvgPricePaid: avg }),
  });

describe('the lots — what the cargo aboard cost', () => {
  it('a buy opens a lot; a second buy of the same commodity grows it', () => {
    let t = foldTrip(EMPTY_TRIP, [buy('Gold', 100, 4_700_000)]);
    t = foldTrip(t, [buy('Gold', 50, 2_400_000)]);
    expect(t.lots['gold']).toEqual({ units: 150, paid: 7_100_000 });
  });

  it('MANDATORY: undocking resets NOTHING — the hold does not empty itself at the pad', () => {
    let t = foldTrip(EMPTY_TRIP, [buy('Gold', 100, 4_700_000)]);
    t = foldTrip(t, [ev('Undocked', {})]);
    expect(t.lots['gold']).toEqual({ units: 100, paid: 4_700_000 });
    expect(t.since).toBe('dock');
  });

  it('a partial sale spends a proportional share of the lot', () => {
    let t = foldTrip(EMPTY_TRIP, [buy('Gold', 100, 4_000_000)]);
    t = foldTrip(t, [sell('Gold', 25, 1_500_000)]);
    expect(t.lots['gold']).toEqual({ units: 75, paid: 3_000_000 });
  });

  it('a whole-lot sale clears the lot exactly — no dust rows', () => {
    let t = foldTrip(EMPTY_TRIP, [buy('Gold', 100, 4_000_000)]);
    t = foldTrip(t, [sell('Gold', 100, 4_500_000)]);
    expect(t.lots['gold']).toBeUndefined();
  });

  it('a construction contribution depletes the lot without touching the receipt', () => {
    let t = foldTrip(EMPTY_TRIP, [buy('Steel', 700, 2_100_000)]);
    t = foldTrip(t, [
      ev('ColonisationContribution', {
        Contributions: [{ Type: 'steel', Type_Localised: 'Steel', Amount: 700 }],
      }),
    ]);
    expect(t.lots['steel']).toBeUndefined();
    expect(t.lastSale).toBeNull();
  });

  it('NaN and junk amounts never poison a lot', () => {
    const t = foldTrip(EMPTY_TRIP, [
      ev('MarketBuy', { Type: 'gold', Count: 'many', TotalCost: NaN }),
    ]);
    expect(t.lots['gold']).toBeUndefined();
  });
});

describe('the till receipt — the last sale, persistent', () => {
  it("MANDATORY: prefers Frontier's AvgPricePaid over the lots for the basis", () => {
    let t = foldTrip(EMPTY_TRIP, [buy('Gold', 100, 4_000_000)]);
    // AvgPricePaid says 45,000/unit even though our watched lot says 40,000 — the game has seen
    // buys this app never did, and its number wins.
    t = foldTrip(t, [sell('Gold', 100, 5_000_000, 45_000)]);
    expect(t.lastSale).toEqual({
      commodity: 'gold',
      units: 100,
      sale: 5_000_000,
      paid: 4_500_000,
    });
  });

  it('falls back to the lots when the journal gives no average', () => {
    let t = foldTrip(EMPTY_TRIP, [buy('Gold', 100, 4_000_000)]);
    t = foldTrip(t, [sell('Gold', 100, 5_000_000)]);
    expect(t.lastSale?.paid).toBe(4_000_000);
  });

  it('mined cargo sold with no basis anywhere reports paid null, never a fake zero', () => {
    const t = foldTrip(EMPTY_TRIP, [sell('Painite', 20, 9_000_000)]);
    expect(t.lastSale).toEqual({ commodity: 'painite', units: 20, sale: 9_000_000, paid: null });
  });

  it('MANDATORY: the receipt survives an undock and only the NEXT sale replaces it', () => {
    let t = foldTrip(EMPTY_TRIP, [buy('Gold', 10, 400_000)]);
    t = foldTrip(t, [sell('Gold', 10, 500_000)]);
    const first = t.lastSale;
    t = foldTrip(t, [ev('Undocked', {}), ev('Docked', {})]);
    expect(t.lastSale).toEqual(first);
    t = foldTrip(t, [sell('Silver', 5, 250_000, 40_000)]);
    expect(t.lastSale?.commodity).toBe('silver');
  });

  it('accumulates across passes, like every fold the watcher threads', () => {
    let t: TripLedger = EMPTY_TRIP;
    t = foldTrip(t, [buy('Gold', 50, 2_000_000)]);
    t = foldTrip(t, [buy('Gold', 50, 2_000_000)]);
    t = foldTrip(t, [sell('Gold', 100, 4_600_000)]);
    expect(t.lastSale?.paid).toBe(4_000_000);
    expect(t.lots['gold']).toBeUndefined();
  });
});
