import { describe, expect, it } from 'vitest';
import {
  EMPTY_CARRIER_HOLD,
  carrierSnapshot,
  foldCarrierHold,
  type CarrierHoldState,
} from './carrier-hold.js';
import type { ParsedLike } from './docked.js';

/**
 * The carrier-hold fold: what the app is entitled to claim about the member's own carrier.
 *
 * The rules under test are the ones the hub's declared-cargo rows rest on: transfers move cargo in
 * the direction the journal says, trades at the OWN carrier's market move it too, undocking moves
 * nothing, ignorance clamps at zero rather than going negative, and nothing is ever attributed to
 * a carrier the events did not identify.
 */

const at = '2026-08-04T20:00:00Z';

const ev = (name: string, data: Record<string, unknown>): ParsedLike => ({
  name,
  occurredAt: at,
  data,
});

const stats = (id: number, callsign = 'K7Q-B4L', name = 'GRIMS HAULER'): ParsedLike =>
  ev('CarrierStats', { CarrierID: id, Callsign: callsign, Name: name });

const transfer = (
  entries: Array<{ type: string; count: number; direction: 'tocarrier' | 'toship' }>,
): ParsedLike =>
  ev('CargoTransfer', {
    Transfers: entries.map((e) => ({
      Type: e.type.toLowerCase(),
      Type_Localised: e.type,
      Count: e.count,
      Direction: e.direction,
    })),
  });

const tonnesOf = (state: CarrierHoldState, commodity: string): number =>
  state.hold[commodity.toLowerCase()]?.tonnes ?? 0;

describe('identifying the carrier', () => {
  it('CarrierStats names it outright', () => {
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [stats(3700000001)]);
    expect(state.carrier).toEqual({
      marketId: '3700000001',
      callsign: 'K7Q-B4L',
      name: 'GRIMS HAULER',
    });
  });

  it('a transfer while docked at a carrier pad identifies that pad — only an owner can transfer', () => {
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      ev('Docked', { StationType: 'FleetCarrier', MarketID: 3700000002, StationName: 'X2F-27B' }),
      transfer([{ type: 'Steel', count: 400, direction: 'tocarrier' }]),
    ]);
    expect(state.carrier?.marketId).toBe('3700000002');
    expect(tonnesOf(state, 'Steel')).toBe(400);
  });

  it('a transfer with no identity at all is skipped, never guessed', () => {
    // Docked at an ordinary starport: the pad is not a carrier, and no CarrierStats has fired.
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      ev('Docked', { StationType: 'Coriolis', MarketID: 128000001, StationName: 'Vista Ring' }),
      transfer([{ type: 'Steel', count: 400, direction: 'tocarrier' }]),
    ]);
    expect(state.carrier).toBeNull();
    expect(state.hold).toEqual({});
  });

  it('a DIFFERENT carrier id resets the watched hold — the old carrier is gone, its cargo with it', () => {
    const before = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700000001),
      transfer([{ type: 'Steel', count: 400, direction: 'tocarrier' }]),
    ]);
    const after = foldCarrierHold(before, [stats(3700000009, 'V9V-1XX', 'REPLACEMENT')]);
    expect(after.carrier?.marketId).toBe('3700000009');
    expect(after.hold).toEqual({});
  });
});

describe('transfer semantics', () => {
  it('tocarrier adds, toship removes, in one event', () => {
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700000001),
      transfer([
        { type: 'Steel', count: 600, direction: 'tocarrier' },
        { type: 'Titanium', count: 200, direction: 'tocarrier' },
      ]),
      transfer([{ type: 'Steel', count: 150, direction: 'toship' }]),
    ]);
    expect(tonnesOf(state, 'Steel')).toBe(450);
    expect(tonnesOf(state, 'Titanium')).toBe(200);
  });

  it('★ withdrawing what we never saw deposited clamps at zero, and the zero row STAYS ★', () => {
    /*
     * The fold starts empty on app launch, so cargo loaded last week is invisible to it. Watching
     * 300 t leave must not produce -300 — and the zero row is kept because "we watched this empty
     * out" is exactly the statement that lets the hub retire a stale figure.
     */
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700000001),
      transfer([{ type: 'Steel', count: 300, direction: 'toship' }]),
    ]);
    expect(tonnesOf(state, 'Steel')).toBe(0);
    expect(state.hold['steel']).toBeDefined();
    // And the snapshot carries the zero out to the hub rather than staying silent about it.
    expect(carrierSnapshot(state)?.commodities).toEqual([{ commodity: 'Steel', tonnes: 0 }]);
  });
});

describe('trading at the carrier market', () => {
  const withCargo = foldCarrierHold(EMPTY_CARRIER_HOLD, [
    stats(3700000001),
    transfer([{ type: 'Steel', count: 500, direction: 'tocarrier' }]),
  ]);

  it('selling TO the own carrier puts stock aboard; buying FROM it takes stock off', () => {
    const state = foldCarrierHold(withCargo, [
      ev('MarketSell', { Type: 'titanium', Type_Localised: 'Titanium', Count: 120, MarketID: 3700000001 }),
      ev('MarketBuy', { Type: 'steel', Type_Localised: 'Steel', Count: 80, MarketID: 3700000001 }),
    ]);
    expect(tonnesOf(state, 'Titanium')).toBe(120);
    expect(tonnesOf(state, 'Steel')).toBe(420);
  });

  it('trades at ANY OTHER market leave the carrier hold alone', () => {
    const state = foldCarrierHold(withCargo, [
      ev('MarketBuy', { Type: 'steel', Type_Localised: 'Steel', Count: 999, MarketID: 128000001 }),
      ev('MarketSell', { Type: 'steel', Type_Localised: 'Steel', Count: 999, MarketID: 128000001 }),
    ]);
    expect(tonnesOf(state, 'Steel')).toBe(500);
  });
});

describe('undocking', () => {
  it('changes nothing about the hold — staging cargo on a carrier is the point of one', () => {
    const before = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      ev('Docked', { StationType: 'FleetCarrier', MarketID: 3700000001, StationName: 'K7Q-B4L' }),
      transfer([{ type: 'Steel', count: 500, direction: 'tocarrier' }]),
    ]);
    const after = foldCarrierHold(before, [ev('Undocked', {}), ev('FSDJump', { StarSystem: 'Nervi' })]);
    expect(after.hold).toEqual(before.hold);
    expect(after.carrier).toEqual(before.carrier);
    expect(after.dockedCarrierId).toBeNull();
  });
});

describe('the snapshot', () => {
  it('is null until there is both an identity and a witnessed movement', () => {
    expect(carrierSnapshot(EMPTY_CARRIER_HOLD)).toBeNull();
    // Identity alone: an empty push from a fresh start would say nothing. Not made.
    expect(carrierSnapshot(foldCarrierHold(EMPTY_CARRIER_HOLD, [stats(3700000001)]))).toBeNull();
  });

  it('is sorted by commodity, so identical states serialise identically', () => {
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700000001),
      transfer([
        { type: 'Titanium', count: 1, direction: 'tocarrier' },
        { type: 'Aluminium', count: 2, direction: 'tocarrier' },
        { type: 'Steel', count: 3, direction: 'tocarrier' },
      ]),
    ]);
    expect(carrierSnapshot(state)?.commodities.map((c) => c.commodity)).toEqual([
      'Aluminium',
      'Steel',
      'Titanium',
    ]);
  });
});
