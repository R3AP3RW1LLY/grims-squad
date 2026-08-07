import { describe, expect, it } from 'vitest';
import { holdOf, unrealised, worthAsking } from './cargo-value.js';

/**
 * What the hold is worth, and when it is worth asking.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "we want valiue information but its showing irrellevant sell information in it!"
 *
 * The panel used to answer "what did I pay" and "what did I last sell" — a sunk cost and a receipt
 * for a trip already over. Neither tells a member holding seven hundred tonnes the thing they
 * actually want to know, which is what it is worth and where to take it.
 *
 * ★ THE ASKING IS RATE-LIMITED, AND THAT IS THE POINT ★
 *
 * Valuing a hold is a query per commodity against eighteen million rows. Cargo changes on every
 * single scoop of a mining session, so asking on every change would be hundreds of fan-outs an
 * hour to answer a question whose answer barely moved. `worthAsking` is where that judgement lives.
 */

describe('the hold, as the hub wants it', () => {
  it('MANDATORY: commodity names to tonnes', () => {
    const hold = holdOf([
      { commodity: 'Painite', count: 200, wanted: false, paid: null },
      { commodity: 'Tritium', count: 40, wanted: true, paid: 1000 },
    ]);

    expect(hold).toEqual({ Painite: 200, Tritium: 40 });
  });

  it('MANDATORY: limpets are not cargo worth valuing', () => {
    /*
     * Drones sit in the hold and are consumed, not sold. Asking the market what a member's limpets
     * are worth wastes a query on every mining session and puts a line on the panel that reads as
     * though the hold is fuller of value than it is.
     */
    const hold = holdOf([
      { commodity: 'Limpet', count: 300, wanted: false, paid: 30_000 },
      { commodity: 'Painite', count: 100, wanted: false, paid: null },
    ]);

    expect(hold['Limpet']).toBeUndefined();
    expect(hold['Painite']).toBe(100);
  });

  it('MANDATORY: an empty hold asks nothing', () => {
    expect(holdOf([])).toEqual({});
  });
});

describe('the unrealised number', () => {
  it('MANDATORY: worth now minus what was paid', () => {
    expect(unrealised(5_000_000, 2_000_000)).toBe(3_000_000);
  });

  it('MANDATORY: a loss is a loss, not hidden', () => {
    // A member who bought badly needs to know before they fly two hundred light years to find out.
    expect(unrealised(1_000_000, 4_000_000)).toBe(-3_000_000);
  });

  it('MANDATORY: no basis means no number, rather than counting the whole hold as profit', () => {
    /*
     * Mined and mission cargo were never bought, so `totalPaid` is zero and the "profit" would be
     * the entire value of the hold. That is not a lie the panel should tell — a miner would see a
     * gain they never made. Null, and the line simply does not render.
     */
    expect(unrealised(5_000_000, 0)).toBeNull();
  });

  it('MANDATORY: nothing valued means no number', () => {
    expect(unrealised(null, 2_000_000)).toBeNull();
  });
});

describe('deciding when to ask the hub', () => {
  const T0 = Date.parse('2026-08-06T20:00:00Z');

  it('MANDATORY: asks when there is a hold and nothing has been asked yet', () => {
    expect(worthAsking({ hold: { Painite: 10 }, askedAt: null, askedFor: null, now: T0 })).toBe(true);
  });

  it('MANDATORY: never asks about an empty hold', () => {
    // There is nothing to value, and the answer is known without a query.
    expect(worthAsking({ hold: {}, askedAt: null, askedFor: null, now: T0 })).toBe(false);
  });

  it('MANDATORY: does not ask again for the same hold', () => {
    /*
     * The specific waste this prevents. Cargo events fire constantly; the hold they describe is
     * usually the one we already priced.
     */
    const hold = { Painite: 100, Tritium: 20 };

    expect(worthAsking({ hold, askedAt: T0, askedFor: hold, now: T0 + 5_000 })).toBe(false);
  });

  it('MANDATORY: asks again when the hold actually changes', () => {
    expect(
      worthAsking({
        hold: { Painite: 200 },
        askedAt: T0,
        askedFor: { Painite: 100 },
        now: T0 + 5_000,
      }),
    ).toBe(true);
  });

  it('MANDATORY: a scoop at a time does not re-ask on every tonne', () => {
    /*
     * ★ THE MINING SESSION ★
     *
     * A laser miner's hold grows by one tonne every few seconds for an hour. Treating each as a
     * change would be several hundred fan-outs to watch a number creep. A small movement waits for
     * the cooldown; a big one does not.
     */
    const asked = { Painite: 100 };

    expect(
      worthAsking({ hold: { Painite: 101 }, askedAt: T0, askedFor: asked, now: T0 + 5_000 }),
    ).toBe(false);
  });

  it('MANDATORY: selling a whole line off re-prices at once', () => {
    /*
     * The mutation that proved this was missing. The change detector sums movement over the
     * commodities CURRENTLY aboard, so a line that has gone entirely contributes nothing — sell two
     * hundred tonnes of Painite and, inside the cooldown, the panel would go on showing what the
     * hold was worth before the sale. Stale by exactly the amount that just left the ship, which is
     * the confusing-number problem this rework exists to end.
     */
    expect(
      worthAsking({
        hold: { Tritium: 20 },
        askedAt: T0,
        askedFor: { Painite: 100, Tritium: 20 },
        now: T0 + 5_000,
      }),
    ).toBe(true);
  });

  it('MANDATORY: after the cooldown even a small change is asked', () => {
    const asked = { Painite: 100 };

    expect(
      worthAsking({ hold: { Painite: 101 }, askedAt: T0, askedFor: asked, now: T0 + 10 * 60_000 }),
    ).toBe(true);
  });

  it('MANDATORY: a new commodity is asked immediately, however few tonnes', () => {
    /*
     * One tonne of Void Opal changes the answer to "where do I sell this" completely, where one
     * more tonne of something already aboard does not.
     */
    expect(
      worthAsking({
        hold: { Painite: 100, 'Void Opal': 1 },
        askedAt: T0,
        askedFor: { Painite: 100 },
        now: T0 + 5_000,
      }),
    ).toBe(true);
  });
});
