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

  it('★ MANDATORY: a zero we never watched ARRIVE is not sent ★', () => {
    /*
     * ★ THIS TEST ASSERTED THE BUG — SQUADRON OWNER, 2026-08-17 ★
     *
     * "we did see carrier inventory in the overlay, but then it disappeared"
     *
     * It used to be called "the zero row STAYS", and it was wrong in the way that matters. The fold
     * starts empty on app launch, so cargo loaded last week is invisible to it. Watching 300 t of
     * that leave clamps to zero — `adjust` calls this "the fold's ignorance, not negative cargo" —
     * and the snapshot then shipped that ignorance to the hub as a statement of fact.
     *
     * Downstream nothing could tell it apart from a real zero. A journal figure outranks the market
     * mirror and, being the newest reading, outranks Frontier's manifest too. So ONE sale of cargo
     * the app never saw arrive silently emptied a commodity off the project page, the carriers tab
     * and the overlay a member reads mid-flight. Measured on production: 26 of 34 rows were zeros.
     *
     * The clamp is still right — negative cargo is not a thing. What changed is that we no longer
     * TELL anybody about a zero we cannot vouch for, so a source that can see the whole hold is
     * left to answer instead.
     */
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700000001),
      transfer([{ type: 'Steel', count: 300, direction: 'toship' }]),
    ]);

    expect(tonnesOf(state, 'Steel'), 'still clamped — negative cargo is not a thing').toBe(0);
    expect(state.hold['steel']?.witnessed, 'but we never watched any arrive').toBe(false);
    /*
     * NO PUSH AT ALL, not a push carrying an empty list.
     *
     * The distinction matters more than it looks. `replaceCapiCargo` treats an empty manifest as
     * proof a hold is empty, and the hub's journal path replaces rather than accumulates — so an
     * empty list is a claim, not a silence. With nothing witnessed and no CarrierStats total, the
     * honest act is to say nothing and leave the mirror and Frontier to answer.
     */
    expect(
      carrierSnapshot(state),
      'an absence must stay silent, or it overrules every source that can actually see the hold',
    ).toBeNull();
  });

  it('★ MANDATORY: a zero we DID watch empty out is still sent ★', () => {
    /*
     * The other half, and the reason this is not simply "never send zeros". Watching cargo arrive
     * and then leave is a real account of the hold, and it is the statement that lets the hub retire
     * a stale figure — without it a sold-out commodity would be promised for ever.
     */
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700000001),
      transfer([{ type: 'Steel', count: 300, direction: 'tocarrier' }]),
      transfer([{ type: 'Steel', count: 300, direction: 'toship' }]),
    ]);

    expect(tonnesOf(state, 'Steel')).toBe(0);
    expect(state.hold['steel']?.witnessed, 'we saw it arrive, so we may speak for it').toBe(true);
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

/**
 * The two things that made the hold wrong in production.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "carrier hold info is not updating properly in the companion app or the website, we need this
 * investigated and we need this to be way more accurate than it is currently"
 *
 * Production held exactly ONE commodity row for the squadron's carrier. Two separate causes, and
 * neither was the fold getting its arithmetic wrong.
 */
describe('refuelling takes tritium out of the hold', () => {
  /*
   * `CarrierDepositFuel` moves tritium from the carrier's CARGO into its fuel tank, and it was not
   * handled at all. It is the single most common thing an owner does to a carrier, so every tonne
   * of tritium ever carried aboard stayed on the books for ever and the figure only ever climbed —
   * a carrier that had long since jumped its tritium away still reported carrying it.
   */
  const deposit = (id: number, amount: number): ParsedLike =>
    ev('CarrierDepositFuel', { CarrierID: id, Amount: amount, Total: 1000 });

  it('MANDATORY: a deposit subtracts from the tritium aboard', () => {
    const after = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700005632),
      transfer([{ type: 'Tritium', count: 500, direction: 'tocarrier' }]),
      deposit(3700005632, 200),
    ]);

    expect(tonnesOf(after, 'Tritium')).toBe(300);
  });

  it('clamps at zero — a member can deposit tritium the app never watched arrive', () => {
    const after = foldCarrierHold(EMPTY_CARRIER_HOLD, [stats(3700005632), deposit(3700005632, 400)]);
    expect(tonnesOf(after, 'Tritium')).toBe(0);
  });

  it('somebody else’s carrier is none of our business', () => {
    const after = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700005632),
      transfer([{ type: 'Tritium', count: 500, direction: 'tocarrier' }]),
      deposit(9999999999, 500),
    ]);

    expect(tonnesOf(after, 'Tritium')).toBe(500);
  });
});

describe('the true total, so the gap is visible', () => {
  /*
   * The fold is a WITNESS: it knows what it watched move and nothing else, so a carrier holding
   * twenty commodities shows however many the app happened to see. Nothing said so, and one
   * commodity presented without comment reads as the whole hold.
   *
   * `SpaceUsage.Cargo` is the game's own total tonnage aboard — no breakdown, but true. Keeping it
   * is what lets the app say "watched 500 t of the 12,400 t aboard" instead of implying the two
   * are the same number.
   */
  const statsWithUsage = (id: number, cargo: number): ParsedLike =>
    ev('CarrierStats', {
      CarrierID: id,
      Callsign: 'K7Q-B4L',
      Name: 'GRIMS HAULER',
      SpaceUsage: { TotalCapacity: 25000, Cargo: cargo, FreeSpace: 25000 - cargo },
    });

  it('MANDATORY: the total is kept, and is not the same as what was watched', () => {
    const after = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      statsWithUsage(3700005632, 12400),
      transfer([{ type: 'Tritium', count: 500, direction: 'tocarrier' }]),
    ]);

    expect(after.totalTonnes).toBe(12400);
    expect(tonnesOf(after, 'Tritium')).toBe(500);
    // The gap IS the point: 11,900 t aboard that this app has never seen move.
    expect(after.totalTonnes! - 500).toBe(11900);
  });

  it('is stamped with the JOURNAL’s time, not the clock', () => {
    // A pass may be replaying a file written hours ago; stamping "now" would present an old
    // reading as a fresh one, which is the lie the total exists to stop telling.
    const after = foldCarrierHold(EMPTY_CARRIER_HOLD, [statsWithUsage(3700005632, 900)]);
    expect(after.totalAt).toBe(Date.parse(at));
  });

  it('stays null until carrier management is opened — absent, not guessed', () => {
    const after = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700005632),
      transfer([{ type: 'Tritium', count: 500, direction: 'tocarrier' }]),
    ]);

    expect(after.totalTonnes).toBeNull();
    expect(after.totalAt).toBeNull();
  });
});


describe('the snapshot carries the true total', () => {
  /*
   * ★ THE HALF THAT WAS CAPTURED AND NEVER SENT ★
   *
   * The fold learned `CarrierStats.SpaceUsage.Cargo` and `carrierSnapshot` dropped it, so the hub
   * received a list of witnessed commodities with nothing to weigh it against — and a carrier the
   * app had seen one commodity move on looked, on screen, like a carrier holding one commodity.
   */
  const statsWithUsage = (id: number, cargo: number): ParsedLike =>
    ev('CarrierStats', {
      CarrierID: id,
      Callsign: 'K7Q-B4L',
      Name: 'GRIMS HAULER',
      SpaceUsage: { TotalCapacity: 25000, Cargo: cargo, FreeSpace: 25000 - cargo },
    });

  it('MANDATORY: sends the total alongside the witnessed commodities', () => {
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      statsWithUsage(3700005632, 12400),
      transfer([{ type: 'Tritium', count: 500, direction: 'tocarrier' }]),
    ]);

    const snap = carrierSnapshot(state);
    expect(snap?.totalTonnes).toBe(12400);
    expect(snap?.commodities).toEqual([{ commodity: 'Tritium', tonnes: 500 }]);
    // The gap is the whole point: 11,900 t aboard that nothing has watched.
    expect((snap?.totalTonnes ?? 0) - 500).toBe(11900);
  });

  it('MANDATORY: a total with nothing witnessed is still worth sending', () => {
    /*
     * This returned null unless something had been watched move — right for a list of commodities,
     * wrong for the total. A member opening carrier management on a full hold the app never saw
     * load has the most useful reading there is, and it was discarded.
     */
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [statsWithUsage(3700005632, 12400)]);

    const snap = carrierSnapshot(state);
    expect(snap).not.toBeNull();
    expect(snap?.totalTonnes).toBe(12400);
    expect(snap?.commodities).toEqual([]);
  });

  it('the timestamp is the journal’s, sent as ISO', () => {
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [statsWithUsage(3700005632, 900)]);
    expect(carrierSnapshot(state)?.totalAt).toBe(new Date(at).toISOString());
  });

  it('no carrier identified is still nothing to say', () => {
    expect(carrierSnapshot(EMPTY_CARRIER_HOLD)).toBeNull();
  });
});

/**
 * ★ THE NAME THE HUB IS SENT — SQUADRON OWNER, 2026-08-09 ★
 *
 * "ensure that what is in a carriers hold is tracking on the whats needed and where to buy tabs ...
 * its supposed to appear in yellow so we know what we need and dont need"
 *
 * ★ WHY NOTHING IN THIS FILE CAUGHT IT ★
 *
 * Every fixture above supplies `Type_Localised`. The helper at the top of this file builds it
 * automatically — `Type: e.type.toLowerCase(), Type_Localised: e.type` — so the localised branch is
 * the only one any of these tests has ever taken.
 *
 * Frontier does not always supply it. It is omitted for exactly the commodities whose symbol is
 * already the plain word: `steel`, `aluminium`, `tritium`, `bertrandite`. So the fallback fired in
 * production and nowhere else, and it stored `steel` where every other table says `Steel`.
 *
 * `colony_needs.commodity` is a display name, so the carrier-cover join matched nothing and the
 * yellow "already aboard" segment never appeared. Measured on production: 1,298 t of Steel and
 * 1,186 t of Aluminium aboard one carrier serving four builds, invisible on all four, with the
 * shopping list quoting a trip to buy Steel the squadron already owned.
 */
describe('the commodity name sent to the hub', () => {
  const bare = (type: string, count: number): ParsedLike =>
    ev('CargoTransfer', { Transfers: [{ Type: type, Count: count, Direction: 'tocarrier' }] });

  it('★ MANDATORY: a symbol with no localised name is stored as a display name ★', () => {
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [stats(3700000001), bare('steel', 500)]);
    const snapshot = carrierSnapshot(state);

    expect(
      snapshot?.commodities.map((c) => c.commodity),
      'sent as the raw symbol, which matches no colonisation need and stays invisible',
    ).toEqual(['Steel']);
  });

  it('MANDATORY: every commodity Frontier omits the localised name for', () => {
    // The seven found in production on a real carrier, all stored as lower-case symbols.
    const events = [stats(3700000001)];
    for (const symbol of [
      'steel',
      'aluminium',
      'tritium',
      'bertrandite',
      'beryllium',
      'gallite',
      'indite',
    ]) {
      events.push(bare(symbol, 100));
    }

    const names = carrierSnapshot(foldCarrierHold(EMPTY_CARRIER_HOLD, events))?.commodities.map(
      (c) => c.commodity,
    );

    expect(names?.sort()).toEqual([
      'Aluminium',
      'Bertrandite',
      'Beryllium',
      'Gallite',
      'Indite',
      'Steel',
      'Tritium',
    ]);
  });

  it('still prefers the localised name when the game gives one', () => {
    /*
     * The localised name is authoritative and is NOT reconstructed from the symbol — `Low Temp.
     * Diamonds` could never be derived from `lowtemperaturediamond`, which is why the game sends it.
     */
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700000001),
      ev('CargoTransfer', {
        Transfers: [
          {
            Type: 'lowtemperaturediamond',
            Type_Localised: 'Low Temp. Diamonds',
            Count: 20,
            Direction: 'tocarrier',
          },
        ],
      }),
    ]);

    expect(carrierSnapshot(state)?.commodities.map((c) => c.commodity)).toEqual([
      'Low Temp. Diamonds',
    ]);
  });

  it('leaves an already-capitalised symbol alone', () => {
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700000001),
      bare('CMM Composite', 264),
    ]);
    expect(carrierSnapshot(state)?.commodities.map((c) => c.commodity)).toEqual(['CMM Composite']);
  });
});

/**
 * The whole hold, read from the journal folder.
 *
 * ★ SQUADRON OWNER, 2026-08-17 ★
 *
 * "why can we not see this from journal logs? we should!"
 *
 * We can. Every other case in this fold is a DELTA — what moved while the app was watching — so a
 * carrier loaded before the app started stayed invisible, and Frontier's cAPI was the only thing
 * that could ever have filled it in. That made complete carrier cargo depend on a subsystem that
 * has never once run in production.
 *
 * `Market.json` is rewritten whenever a market screen opens, and for a fleet carrier it lists the
 * carrier's whole stock per commodity. The watcher already reads that file and merges `Items` into
 * the `Market` event for the price path — the data has been arriving in this fold all along and
 * nothing looked at it.
 */
describe('reading the whole hold from Market.json', () => {
  const market = (marketId: number, items: ReadonlyArray<Record<string, unknown>>) => ({
    name: 'Market',
    occurredAt: '2026-08-17T12:00:00Z',
    data: { event: 'Market', MarketID: marketId, Items: items },
  });

  it('★ MANDATORY: the manifest sets the hold, including cargo never watched arrive ★', () => {
    /*
     * The whole point. The fold has seen nothing move — this is a fresh app start on a carrier that
     * was loaded last week — and it now knows the entire hold anyway.
     */
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700000001),
      market(3700000001, [
        { Name: '$steel_name;', Name_Localised: 'Steel', Stock: 20261, Demand: 0 },
        { Name: '$aluminium_name;', Stock: 858, Demand: 0 },
      ]),
    ]);

    expect(tonnesOf(state, 'Steel')).toBe(20261);
    expect(tonnesOf(state, 'Aluminium'), 'the symbol fallback is title-cased').toBe(858);
    expect(
      state.hold['steel']?.witnessed,
      'a whole-manifest reading may speak for a zero later — it has seen the hold itself',
    ).toBe(true);
  });

  it('★ MANDATORY: it REPLACES — a commodity absent from the manifest is gone ★', () => {
    /*
     * The property no delta can have. The fold watched 500 t of Titanium arrive; the manifest since
     * read does not list it, so it has been sold. Adjusting would have kept it for ever.
     */
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700000001),
      transfer([{ type: 'Titanium', count: 500, direction: 'tocarrier' }]),
      market(3700000001, [{ Name: '$steel_name;', Name_Localised: 'Steel', Stock: 300, Demand: 0 }]),
    ]);

    expect(tonnesOf(state, 'Steel')).toBe(300);
    expect(state.hold['titanium'], 'absent from a complete manifest means absent').toBeUndefined();
  });

  it('★ MANDATORY: somebody ELSE’S carrier does not overwrite ours ★', () => {
    /*
     * Market.json holds only the LAST market opened, so docking at another commander's carrier
     * writes their manifest to the same file. Storing that under our id is the identity confusion
     * the `Docked` case is careful to avoid.
     */
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700000001),
      transfer([{ type: 'Steel', count: 400, direction: 'tocarrier' }]),
      market(3999999999, [{ Name: '$gold_name;', Name_Localised: 'Gold', Stock: 9999, Demand: 0 }]),
    ]);

    expect(tonnesOf(state, 'Steel')).toBe(400);
    expect(state.hold['gold']).toBeUndefined();
  });

  it('demand is not cargo — only Stock counts', () => {
    // `Demand` is what the carrier is asking to BUY. It is somebody else's cargo until it arrives.
    const state = foldCarrierHold(EMPTY_CARRIER_HOLD, [
      stats(3700000001),
      market(3700000001, [
        { Name: '$steel_name;', Name_Localised: 'Steel', Stock: 0, Demand: 5000 },
        { Name: '$gold_name;', Name_Localised: 'Gold', Stock: 12, Demand: 0 },
      ]),
    ]);

    expect(state.hold['steel'], 'wanted is not held').toBeUndefined();
    expect(tonnesOf(state, 'Gold')).toBe(12);
  });
});
