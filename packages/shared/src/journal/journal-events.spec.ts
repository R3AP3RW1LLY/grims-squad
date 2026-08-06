import { describe, it, expect } from 'vitest';
import {
  JOURNAL_EVENTS,
  EVENT_FIELDS,
  isAllowedEvent,
  pickAllowedFields,
  isLiveGameVersion,
  canonicalJson,
  telemetryCategoryFor,
  isBaselineCategory,
  OPTIONAL_CATEGORIES,
  type JournalEventName,
} from './journal-events.js';

/**
 * What the companion app is allowed to send (P1.11).
 *
 * ★ THE PRIVACY DESIGN IS THE ORDERING ★
 *
 * Elite's journal holds hundreds of event types and a great deal that is
 * nobody's business. The app filters on the MEMBER'S OWN MACHINE, before
 * anything is transmitted — because "we promise to throw it away" is a far
 * weaker promise than never having received it.
 *
 * These tests exist so that adding an event, or widening a field list, is a
 * deliberate act that shows up in review rather than something that drifts in
 * with a feature.
 */
describe('the event allowlist', () => {
  it('MANDATORY: is an ALLOWLIST — an unlisted event is refused', () => {
    /*
     * The failure mode of a blocklist is that every game update adds events
     * nobody has thought about, and they flow straight through.
     *
     * These are the ones that must stay out however far the list widens. Chat,
     * the friends list, what crimes they committed — none of it answers a
     * question the squadron has, and all of it is the sort of thing that
     * arrives quietly with a feature nobody reviewed.
     *
     * `Died` was on this list and was REMOVED on 2026-07-29, deliberately, to
     * build a killboard. It names another commander — but so does `PVPKill`,
     * which was always collected, and a board with only kills and no losses is
     * a scoreboard rather than a killboard. Excluding one side while sending
     * the other was the real inconsistency.
     */
    for (const denied of [
      'SendText',
      'ReceiveText',
      'Friends',
      'CommitCrime',
      'Interdicted',
      'Statistics',
      'Materials',
      'Fileheader',
    ]) {
      expect(isAllowedEvent(denied), denied).toBe(false);
    }
  });

  it('MANDATORY: the BASELINE is exactly the six squadron events', () => {
    /*
     * These six are collected from everybody running the app, with no opt-out
     * (INV-013). The list is pinned here because widening it widens what is
     * collected WITHOUT ASKING — which is a decision that must show up in
     * review, not drift in with a feature.
     */
    const baseline = Object.entries(JOURNAL_EVENTS)
      .filter(([name]) => isBaselineCategory(telemetryCategoryFor(name as JournalEventName)))
      .map(([name]) => name)
      .sort();

    expect(baseline).toEqual([
      'LoadGame',
      'Loadout',
      'Progress',
      'Rank',
      'SquadronStartup',
      'StoredShips',
    ]);
  });

  it('MANDATORY: pins every event outside the required category', () => {
    /*
     * ★ THE NAME CHANGED WITH THE MODEL (2026-07-29) ★
     *
     * This was "everything beyond the baseline needs consent" — true under
     * opt-in, false now. These events are collected BY DEFAULT and a member
     * switches them off.
     *
     * Which makes the list MORE important, not less: adding an event here now
     * widens what is collected without anybody asking, so it has to show up in
     * review rather than drift in with a feature.
     */
    const optional = Object.entries(JOURNAL_EVENTS)
      .filter(([name]) => !isBaselineCategory(telemetryCategoryFor(name as JournalEventName)))
      .map(([name]) => name)
      .sort();

    expect(optional).toEqual([
      /*
       * ★ ADDED 2026-08-06, DELIBERATELY AND FOR ONE REASON ★
       *
       * The dashboard answers "where in the system are they" from the newest of five events. Three
       * of the five — this, SupercruiseExit and Undocked — were never collectable: absent from the
       * events map, so the companion never sent them and the server would have discarded them.
       * Production had ZERO rows of all three, ever.
       *
       * They were added to the profile QUERY on 2026-08-05, which changed nothing anybody could
       * see, and the squadron owner reported the same stale location again the next day.
       *
       * All three are in the EXISTING `location` category, so a member who has switched location
       * off is still sending none of them. This widens what a consenting member reports, not who
       * is asked — which is exactly the distinction this pinned list exists to surface.
       */
      'ApproachSettlement',
      /*
       * ★ THE MINING MODULE, 2026-08-06 ★
       *
       * ProspectedAsteroid, AsteroidCracked and LaunchDrone, in their OWN `mining` category rather
       * than folded into `trade` where MiningRefined lives. The reason is volume: ProspectedAsteroid
       * fires on every limpet hit, several hundred an hour, against roughly twenty MiningRefined.
       *
       * A member happy for us to see what they hauled has not thereby agreed to send a row for
       * every rock they shoot at. This is a genuinely new thing collected, from a new switch, and
       * that is exactly what this pinned list exists to put in front of a reviewer.
       */
      'AsteroidCracked',
      'Bounty',
      /*
       * Added 2026-08-04 for the colonisation carrier holds. Under `carrier` with the other
       * own-carrier events: cargo moved between a member's ship and their own carrier is the only
       * record that staged build cargo exists — the public mirror sees only sell orders. The
       * retained field is the `Transfers` array alone (Type, Count, Direction); it carries no
       * prices and names nobody else.
       */
      'CargoTransfer',
      'CarrierJump',
      'CarrierStats',
      /*
       * Added 2026-08-02, for colonisation. In their OWN category so they can be declined without
       * giving up the trade leaderboard: a delivery says a member was at a specific construction
       * site at a specific moment, which is more than a tonnage.
       *
       * ★ THE WIDENING THIS LIST EXISTS TO SURFACE — SAY IT PLAINLY ★
       *
       * `ColonisationConstructionDepot` keeps its `ResourcesRequired` ARRAY, which no other event
       * here is allowed to do (`Market.Items` is dropped for exactly that reason). The difference
       * is that a market's item list is public data filed under a person, and a construction site's
       * outstanding needs exist nowhere else in the world — no API publishes them. Without the
       * array we would store that somebody docked at a building site and nothing about the
       * building. Squadron owner, 2026-08-02, chose this collected on by default.
       */
      'ColonisationConstructionDepot',
      'ColonisationContribution',
      'Died',
      'Docked',
      'FSDJump',
      'FactionKillBond',
      'LaunchDrone',
      'Location',
      // Added 2026-08-01 for live market prices. Optional, under `trade`: a
      // member who declines trade telemetry does not feed the price table.
      'Market',
      'MarketBuy',
      'MarketSell',
      'MiningRefined',
      'MissionCompleted',
      'MultiSellExplorationData',
      'PVPKill',
      'ProspectedAsteroid',
      'SAAScanComplete',
      'SellExplorationData',
      'SellMicroResources',
      /*
       * Added 2026-08-01 for the squadron weapons chart. Optional, and in its OWN category
       * (`onfoot`) rather than folded into fleet or combat — an on-foot loadout says more about how
       * somebody plays than a hull does, and a member happy to share their Python should not have
       * to accept sharing their suit to keep it.
       */
      'SuitLoadout',
      // Both added 2026-08-06 alongside ApproachSettlement — see the note at the head of this
      // list. SupercruiseExit says where they dropped out; Undocked is the only event that says
      // "no longer anywhere in particular", without which somebody who leaves a station shows as
      // docked there for ever.
      'SupercruiseExit',
      'Undocked',
    ]);
  });

  it('MANDATORY: never sends chat', () => {
    // SendText and ReceiveText carry private conversations, including direct
    // messages. There is no version of this product that needs them.
    expect(isAllowedEvent('SendText')).toBe(false);
    expect(isAllowedEvent('ReceiveText')).toBe(false);
  });
});

describe('field-level filtering', () => {
  it('MANDATORY: keeps the balance but never the Frontier account id', () => {
    /*
     * ★ Credits FLIPPED SIDES ON 2026-07-29 ★
     *
     * This asserted the balance was DROPPED, and under opt-in that was right:
     * nobody had asked for it. The squadron owner has since asked for it on the
     * commander dashboard, and telemetry is opt-out — so it is kept, and a
     * member who does not want it stored switches off `profile`.
     *
     * `Loan` and `FID` stay out regardless. A Frontier account id identifies
     * the member to Frontier and answers no question the squadron has.
     */
    const raw = {
      Commander: 'GRIM',
      Ship: 'Anaconda',
      Credits: 1_204_998_221,
      Loan: 0,
      FID: 'F1234567',
      GameMode: 'Open',
      Odyssey: true,
    };
    const picked = pickAllowedFields('LoadGame', raw);

    expect(picked['Commander']).toBe('GRIM');
    expect(picked['Credits']).toBe(1_204_998_221);
    expect(picked).not.toHaveProperty('Loan');
    expect(picked).not.toHaveProperty('FID');
  });

  it('MANDATORY: the Frontier account ID is never kept, from any event', () => {
    // FID identifies the person to Frontier. It is not ours to hold, and it
    // appears in more events than anyone remembers.
    for (const name of Object.keys(EVENT_FIELDS)) {
      expect(EVENT_FIELDS[name as keyof typeof EVENT_FIELDS], name).not.toContain('FID');
    }
  });

  it('omits an absent field rather than writing undefined', () => {
    // An explicit undefined survives Object.keys and reads as "we have this and
    // it is empty" rather than "we do not have this".
    const picked = pickAllowedFields('LoadGame', { Commander: 'GRIM' });
    expect(Object.keys(picked)).toEqual(['Commander']);
  });

  it('keeps what each event is actually for', () => {
    expect(pickAllowedFields('Rank', { Combat: 7, Trade: 4, Explore: 8 })).toEqual({
      Combat: 7,
      Trade: 4,
      Explore: 8,
    });
    expect(
      pickAllowedFields('SquadronStartup', { SquadronName: "Grim's Squad", CurrentRank: 3 }),
    ).toEqual({ SquadronName: "Grim's Squad", CurrentRank: 3 });
  });

  it('every allowed event has a field list', () => {
    // An event allowed with no field list would pick nothing and look like a
    // silent failure rather than a configuration mistake.
    for (const name of Object.keys(JOURNAL_EVENTS)) {
      expect(EVENT_FIELDS[name as keyof typeof EVENT_FIELDS], name).toBeDefined();
      expect(EVENT_FIELDS[name as keyof typeof EVENT_FIELDS].length).toBeGreaterThan(0);
    }
  });
});

describe('live galaxy only', () => {
  it('MANDATORY: rejects a Legacy (3.8) journal', () => {
    // Horizons 3.8 was split off in 2022 and its galaxy has diverged since.
    // Recording it against a member's current standing would be confidently
    // incorrect rather than merely missing.
    expect(isLiveGameVersion({ gameversion: '3.8.0.407' })).toBe(false);
  });

  it('accepts a Live (4.x) journal', () => {
    expect(isLiveGameVersion({ gameversion: '4.0.0.1904' })).toBe(true);
  });

  it('MANDATORY: does not mistake "no Odyssey" for "Legacy"', () => {
    /*
     * ★ THE BUG THIS EXISTS TO PREVENT ★
     *
     * The obvious field, `LoadGame.Odyssey`, reports whether the player owns
     * the EXPANSION — not which galaxy they are in. A Horizons 4.0 player is on
     * Live and reports `Odyssey: false`.
     *
     * Reading it as a Live/Legacy flag would silently discard everything sent
     * by every member without Odyssey, and the symptom would be those members
     * never qualifying for a promotion for reasons nobody could see.
     */
    expect(isLiveGameVersion({ gameversion: '4.0.0.1904', Odyssey: false })).toBe(true);
  });

  it('treats a journal with no gameversion as Live', () => {
    // Journals predating Update 14 have no gameversion, and they pre-date the
    // split, so they WERE Live when written. Refusing them would throw away
    // real history; accepting a few genuinely old sessions is the milder error.
    expect(isLiveGameVersion({})).toBe(true);
  });
});

describe('money is stripped at every depth', () => {
  it('MANDATORY: drops per-module values inside a Loadout', () => {
    /*
     * ★ THE HOLE THIS CLOSES ★
     *
     * EVENT_FIELDS is a TOP-LEVEL allowlist, and the comment above it — "anything
     * not named here is dropped" — was not true of anything nested. We were
     * carefully excluding `Credits` from LoadGame and then shipping a complete
     * itemised valuation of the member's ship one level down.
     */
    const out = pickAllowedFields('Loadout', {
      Ship: 'python',
      HullValue: 55_000_000,
      ModulesValue: 120_000_000,
      Rebuy: 8_750_000,
      Modules: [
        { Slot: 'MainEngines', Item: 'int_engine_size6_class5', On: true, Value: 45_000_000 },
        { Slot: 'PowerPlant', Item: 'int_powerplant_size7_class5', On: true, Value: 33_000_000 },
      ],
    });

    const asText = JSON.stringify(out);
    expect(asText).not.toContain('55000000');
    expect(asText).not.toContain('120000000');
    expect(asText).not.toContain('8750000');
    expect(asText).not.toContain('45000000');
    expect(asText).not.toContain('33000000');
  });

  it('MANDATORY: keeps the module list itself', () => {
    // The point of the narrow strip. Throwing away the modules to avoid the
    // prices attached to them would take exactly what a fleet doctrine check
    // needs, which is the wrong trade.
    const out = pickAllowedFields('Loadout', {
      Ship: 'python',
      Modules: [{ Slot: 'MainEngines', Item: 'int_engine_size6_class5', On: true, Value: 1 }],
    });

    expect(out['Modules']).toEqual([
      { Slot: 'MainEngines', Item: 'int_engine_size6_class5', On: true },
    ]);
  });

  it('MANDATORY: drops values from stored ships too', () => {
    const out = pickAllowedFields('StoredShips', {
      StarSystem: 'Shinrarta Dezhra',
      ShipsHere: [{ ShipID: 3, ShipType: 'cutter', Name: 'Bertha', Value: 700_000_000 }],
    });

    expect(JSON.stringify(out)).not.toContain('700000000');
    expect(out['ShipsHere']).toEqual([{ ShipID: 3, ShipType: 'cutter', Name: 'Bertha' }]);
  });

  it('does not confuse a legitimate field for a price', () => {
    // `Health` is damage, not money, and a doctrine check may care about it.
    const out = pickAllowedFields('Loadout', {
      Ship: 'python',
      Modules: [{ Slot: 'Hull', Item: 'armour', Health: 0.94, Value: 1 }],
    });
    expect(out['Modules']).toEqual([{ Slot: 'Hull', Item: 'armour', Health: 0.94 }]);
  });
});

describe('canonicalJson', () => {
  it('MANDATORY: sorts keys, so the same object always hashes the same', () => {
    // JSON.stringify preserves insertion order. Without this, the same event
    // parsed twice could produce two different idempotency keys and a retry
    // would be stored again as though it were new.
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('sorts at every depth', () => {
    expect(canonicalJson({ x: { b: 1, a: 2 } })).toBe(canonicalJson({ x: { a: 2, b: 1 } }));
  });

  it('MANDATORY: preserves array ORDER, which is meaningful', () => {
    // Module order is a property of the ship, not an accident of serialisation.
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('distinguishes values that differ', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson({ a: '1' })).not.toBe(canonicalJson({ a: 1 }));
  });
});

describe('mining is its own category, and its own decision', () => {
  /*
   * ★ SQUADRON OWNER, 2026-08-06 ★
   *
   * "our own version of EDminer" — with FULL rock collection chosen deliberately over a summary,
   * because it is the only way to answer "is this ring still paying" from more than one
   * commander's memory. That is the one thing no single-player mining tool can ever do.
   *
   * ★ WHY IT IS NOT FILED UNDER `trade` ★
   *
   * `MiningRefined` already sits under trade, and the tempting thing is to put the rest there too.
   * It would be wrong. `ProspectedAsteroid` fires on EVERY limpet hit — several hundred an hour
   * while somebody is mining, against roughly twenty MiningRefined — and it is by a wide margin the
   * highest-volume thing this platform would ever collect.
   *
   * A member who is happy for us to see what they hauled has not thereby agreed to send a row for
   * every rock they shoot at. Volume that different deserves its own switch, and hiding it inside
   * an existing one would make that switch mean something other than what it says.
   */
  it('MANDATORY: the mining events are collectable', () => {
    for (const name of ['ProspectedAsteroid', 'AsteroidCracked', 'LaunchDrone']) {
      expect(isAllowedEvent(name), `${name} is not collectable, so the mining tool has no data`).toBe(true);
    }
  });

  it('MANDATORY: they are all under `mining`, not folded into trade', () => {
    for (const name of ['ProspectedAsteroid', 'AsteroidCracked', 'LaunchDrone'] as const) {
      expect(
        telemetryCategoryFor(name),
        `${name} is under another category — its volume would arrive on a switch that does not describe it`,
      ).toBe('mining');
    }
  });

  it('MANDATORY: mining is OPTIONAL, never baseline', () => {
    /*
     * The baseline three are what the platform exists to hold — who played, what rank, what they
     * fly. A per-rock stream is emphatically not that, and making it unrefusable would be the
     * exact thing INV-013 was amended to prevent.
     */
    expect(isBaselineCategory('mining')).toBe(false);
    expect(OPTIONAL_CATEGORIES as readonly string[]).toContain('mining');
  });

  it('MANDATORY: a prospected rock keeps its materials, or the tool is blind', () => {
    const kept = pickAllowedFields('ProspectedAsteroid', {
      Materials: [{ Name: 'Painite', Proportion: 38.4 }],
      Content: '$AsteroidMaterialContent_High;',
      Content_Localised: 'High',
      MotherlodeMaterial: 'Platinum',
      Remaining: 100,
      // Not wanted, and named here so the assertion below is about a real field rather than a
      // hypothetical one.
      SurveyorScannerID: 12345,
    });

    expect(kept['Materials'], 'the material list is dropped, so no percentage can ever be shown').toBeDefined();
    expect(kept['Content_Localised']).toBe('High');
    expect(kept['MotherlodeMaterial']).toBe('Platinum');
    expect(kept['SurveyorScannerID'], 'an unnamed field survived the allowlist').toBeUndefined();
  });

  it('MANDATORY: MiningRefined keeps enough to score a tonne', () => {
    // The leaderboard is tonnes × rarity, and rarity is looked up from the name. Losing the name
    // would make every tonne score the floor, silently.
    const kept = pickAllowedFields('MiningRefined', {
      Type: '$painite_name;',
      Type_Localised: 'Painite',
    });

    expect(kept['Type_Localised'] ?? kept['Type']).toBeDefined();
  });
});
