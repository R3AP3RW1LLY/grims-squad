import { describe, expect, it } from 'vitest';
import { EMPTY_TRIP, foldTrip } from './trip-ledger.js';
import type { ParsedLike } from './docked.js';

/**
 * The trip P&L.
 *
 * ★ WHAT THESE TESTS ARE GUARDING ★
 *
 * The overlay prints "Net +Z cr" over somebody's cockpit, and the cheap mistakes are all
 * arithmetic-adjacent rather than arithmetic: a reset that fires on the wrong event, a journal
 * amount that arrives malformed and turns the running sum to NaN, and a contribution counted as
 * income the game never paid.
 */

const ev = (name: string, data: Record<string, unknown> = {}): ParsedLike => ({
  name,
  occurredAt: '2026-08-04T10:00:00Z',
  data,
});

describe('the trip ledger', () => {
  it('starts a fresh app on an empty trip, measured from app start', () => {
    // Nothing is seeded from the journal tail: a ledger rebuilt from half a session would show a
    // number whose starting point nobody can name. `since` says which kind of zero this is.
    expect(EMPTY_TRIP).toEqual({ spent: 0, earned: 0, since: 'start' });
  });

  it('adds a market buy to spent', () => {
    const trip = foldTrip(EMPTY_TRIP, [ev('MarketBuy', { Type: 'steel', Count: 720, TotalCost: 3_240_000 })]);
    expect(trip.spent).toBe(3_240_000);
    expect(trip.earned).toBe(0);
  });

  it('adds a market sell to earned', () => {
    const trip = foldTrip(EMPTY_TRIP, [ev('MarketSell', { Type: 'gold', Count: 100, TotalSale: 4_800_000 })]);
    expect(trip.earned).toBe(4_800_000);
    expect(trip.spent).toBe(0);
  });

  it('accumulates across passes, like the dock tracker', () => {
    // A member buys in one twenty-second window and sells three windows later; the fold takes the
    // previous value so the trip survives the passes in between.
    const bought = foldTrip(EMPTY_TRIP, [ev('MarketBuy', { TotalCost: 1_000 })]);
    const sold = foldTrip(bought, [ev('MarketSell', { TotalSale: 2_500 })]);
    expect(sold).toEqual({ spent: 1_000, earned: 2_500, since: 'start' });
  });

  it('adds the credit a colonisation contribution reports, which is usually nothing', () => {
    /*
     * The game pays nothing at the depot, and the event carries no credit field — so the honest
     * answer is zero, not an invented one. If Frontier ever adds a Credit field, it counts.
     */
    const unpaid = foldTrip(EMPTY_TRIP, [
      ev('ColonisationContribution', { MarketID: 3_706_117_632, Contributions: [] }),
    ]);
    expect(unpaid).toEqual({ spent: 0, earned: 0, since: 'start' });

    const paid = foldTrip(EMPTY_TRIP, [ev('ColonisationContribution', { Credit: 500 })]);
    expect(paid.earned).toBe(500);
  });

  it('resets the whole trip on Undocked — a trip is since leaving the last dock', () => {
    const busy = foldTrip(EMPTY_TRIP, [
      ev('MarketBuy', { TotalCost: 1_000_000 }),
      ev('MarketSell', { TotalSale: 400_000 }),
    ]);
    const departed = foldTrip(busy, [ev('Undocked', { StationName: 'Ambrose Dock' })]);
    expect(departed).toEqual({ spent: 0, earned: 0, since: 'dock' });
  });

  it('does NOT reset on Docked — the visit’s business belongs to this trip', () => {
    // Blanking the ledger on landing would erase the buy the member just made on the way in.
    const bought = foldTrip(EMPTY_TRIP, [ev('MarketBuy', { TotalCost: 1_000 })]);
    expect(foldTrip(bought, [ev('Docked', { MarketID: 42 })])).toEqual(bought);
  });

  it('keeps counting after a reset, within one batch', () => {
    // Undocked mid-batch: the sale before it belonged to the old trip, the buy after to the new.
    const trip = foldTrip(EMPTY_TRIP, [
      ev('MarketSell', { TotalSale: 9_000 }),
      ev('Undocked'),
      ev('MarketBuy', { TotalCost: 700 }),
    ]);
    expect(trip).toEqual({ spent: 700, earned: 0, since: 'dock' });
  });

  it('ignores malformed amounts rather than poisoning the running sum', () => {
    // One NaN in a += chain makes every later number NaN, which the overlay would print.
    const trip = foldTrip(EMPTY_TRIP, [
      ev('MarketBuy', { TotalCost: 'not a number' }),
      ev('MarketBuy', {}),
      ev('MarketSell', { TotalSale: Infinity }),
      ev('MarketBuy', { TotalCost: 100 }),
    ]);
    expect(trip).toEqual({ spent: 100, earned: 0, since: 'start' });
  });
});
