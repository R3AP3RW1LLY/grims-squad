import { describe, expect, it } from 'vitest';
import {
  coverNeed,
  coverNeeds,
  type Holder,
  type OutstandingNeed,
} from './colony-held-cargo.js';

/**
 * Who already has it, and how much of the need that genuinely covers.
 *
 * ★ SQUADRON OWNER, 2026-08-12 ★
 *
 * "we need the ability to track when someone has bought something in a project they are currently
 * on and display it in the WHAT IT STILL NEEDS section and on the Where to buy it tab. Right now we
 * can see cargo holds for fleet carriers - we need the same for individual ships when they buy it
 * so people are not buying the same materials."
 *
 * ★ THE ONE FAILURE EVERY TEST HERE DEFENDS ★
 *
 * "so people are not buying the same materials" is the whole feature, and it names the failure
 * precisely: two members read the same build, both see 900 t of Steel outstanding, both fly to
 * Kremainn and both buy 900 t. The second load has nowhere to go.
 *
 * Which makes `stillToBuy` the single number this file exists to get right — it is the figure a
 * member reads immediately before spending twenty million credits. An overstated one causes the
 * double-buy the owner asked us to stop. An understated one is worse in a quieter way: a build
 * stalls because everyone believed somebody else had it covered.
 */

const holder = (over: Partial<Holder> = {}): Holder => ({
  userId: over.userId ?? 'u-grim',
  commander: over.commander ?? 'Grim',
  commodity: over.commodity ?? 'Steel',
  tonnes: over.tonnes === undefined ? 500 : over.tonnes,
  kind: over.kind ?? 'ship',
  carrierCallsign: over.carrierCallsign === undefined ? null : over.carrierCallsign,
});

const need = (over: Partial<OutstandingNeed> = {}): OutstandingNeed => ({
  commodity: over.commodity ?? 'Steel',
  remaining: over.remaining === undefined ? 900 : over.remaining,
});

/**
 * The invariant asserted in nearly every test below, because it is the one that cannot be allowed
 * to drift: the numbers on the row must be exactly the numbers in the legend under it.
 *
 * ★ THIS IS THE PRIVACY GUARANTEE, EXPRESSED AS ARITHMETIC ★
 *
 * The privacy page commits that a member with "Your recent activity" switched off has their
 * information "ABSENT from what other members and the public receive, not merely hidden by the
 * interface". Held cargo is recent activity, so the API omits those members from the `holders`
 * argument entirely — this function never learns they exist.
 *
 * That omission only holds if there is no OTHER way for their tonnage to reach the page. A `held`
 * that counted a hidden member while their name went unlisted would leak the fact of them — a
 * reader who can add up would see 900 covered by two commanders holding 400 between them and know
 * an unnamed third is out there with 500 t. So: totals are derived from the listed holders and
 * from nothing else, and every test checks the sum.
 */
const legendAddsUp = (out: {
  readonly heldTotal: number;
  readonly holders: readonly Holder[];
}): void => {
  expect(
    out.heldTotal,
    'a total that is not the sum of the names shown is a leak, or a lie, or both',
  ).toBe(out.holders.reduce((n, h) => n + h.tonnes, 0));
};

describe('one commodity a build still needs', () => {
  it('★ MANDATORY: nobody holds it, and the row STILL appears with an empty legend ★', () => {
    /*
     * Absence of a legend is information. "Nobody has this yet" is precisely what a member needs to
     * know before they fly, and it is the commonest state on any build — dropping the row because
     * it has no holders would hide the commodities most in need of buying behind the ones already
     * covered, which inverts the feature.
     */
    const out = coverNeed(need({ remaining: 900 }), []);

    expect(out.holders).toEqual([]);
    expect(out.held).toBe(0);
    expect(out.stillToBuy, 'nobody has any, so all 900 t are still to buy').toBe(900);
    legendAddsUp(out);
  });

  it('★ MANDATORY: held is CAPPED at what the build still needs ★', () => {
    /*
     * Three commanders holding 500 t each against a 900 t need is 900 t covered, not 1,500 t.
     *
     * An uncapped figure says a build is over-supplied when it is not — and it does so by exactly
     * the amount that would otherwise read as spare capacity, which is the number somebody uses to
     * decide to go and haul something else instead. The surplus 600 t is real cargo, but it is
     * cargo this site cannot take, so it must not count toward this site.
     */
    const out = coverNeed(need({ remaining: 900 }), [
      holder({ userId: 'u-a', commander: 'Ash', tonnes: 500 }),
      holder({ userId: 'u-b', commander: 'Brix', tonnes: 500 }),
      holder({ userId: 'u-c', commander: 'Cass', tonnes: 500 }),
    ]);

    expect(out.held, 'capped at the need, never the raw sum').toBe(900);
    expect(out.stillToBuy).toBe(0);
    expect(out.heldTotal, 'the raw sum survives, so the page can say why nobody should buy').toBe(
      1_500,
    );
    expect(out.holders, 'all three are still named — the surplus is theirs to divert').toHaveLength(
      3,
    );
    legendAddsUp(out);
  });

  it('★ MANDATORY: stillToBuy is the number a member reads before buying ★', () => {
    // 900 outstanding, 200 already in somebody's hold: buy 700. Get this wrong and the double-buy
    // this feature exists to prevent happens on the very first evening it ships.
    const out = coverNeed(need({ remaining: 900 }), [holder({ tonnes: 200 })]);

    expect(out.held).toBe(200);
    expect(out.stillToBuy).toBe(700);
    expect(out.heldTotal).toBe(200);
    legendAddsUp(out);
  });

  it('★ MANDATORY: held + stillToBuy always equals remaining ★', () => {
    /*
     * Three numbers printed side by side on the same row. If they contradict each other the member
     * reading them has to guess which one is the real one, and the guess is made in a market screen
     * with a full wallet.
     */
    for (const tonnes of [0, 1, 449, 899, 900, 901, 100_000]) {
      const out = coverNeed(need({ remaining: 900 }), [holder({ tonnes })]);
      expect(out.held + out.stillToBuy, `held + stillToBuy at ${tonnes} t held`).toBe(900);
      expect(out.held).toBeLessThanOrEqual(900);
      expect(out.stillToBuy).toBeGreaterThanOrEqual(0);
    }
  });

  it('★ MANDATORY: a ship hold and a carrier hold both count, and stay told apart ★', () => {
    /*
     * They are not the same thing and the legend must not merge them. Carrier cargo is PARKED: it
     * is at a berth, it is not going anywhere by itself, and somebody still has to fly it in.
     * Ship cargo is MOVING: a commander has it aboard right now and is on their way.
     *
     * A member deciding what to do tonight reads those differently — 4,000 t parked on a carrier
     * that has been in the next system for a week is not the same news as 400 t inbound.
     */
    const out = coverNeed(need({ remaining: 5_000 }), [
      holder({ userId: 'u-a', commander: 'Ash', tonnes: 400, kind: 'ship' }),
      holder({
        userId: 'u-b',
        commander: 'Brix',
        tonnes: 4_000,
        kind: 'carrier',
        carrierCallsign: 'K7Q-B4L',
      }),
    ]);

    expect(out.held).toBe(4_400);
    expect(out.stillToBuy).toBe(600);
    expect(out.carrierTonnes, 'parked').toBe(4_000);
    expect(out.shipTonnes, 'moving').toBe(400);
    expect(out.holders.map((h) => h.kind)).toEqual(['carrier', 'ship']);
    expect(
      out.holders[0]?.carrierCallsign,
      'the owner asked for the carrier id beside the commander name',
    ).toBe('K7Q-B4L');
    expect(out.holders[1]?.carrierCallsign, 'a ship is not aboard a carrier').toBeNull();
    legendAddsUp(out);
  });

  it('★ MANDATORY: the journal spelling and the catalogue spelling are ONE commodity ★', () => {
    /*
     * The game's Cargo event says `H.E. Suits`; the catalogue and therefore `colony_needs` say
     * `Hazardous Environment Suits`. Matching on raw equality means the two never meet, and the
     * failure is SILENT and in the worst possible direction: the row reads "nobody holds this" to
     * a member who is standing next to somebody holding 117 t of it.
     *
     * `commodityKey` exists for exactly this comparison (see commodity-name.ts, found in production
     * on 2026-08-12) and this is the second place that has needed it. Case is the same story — the
     * journal's `steel` and the catalogue's `Steel` are one thing.
     */
    const out = coverNeed(need({ commodity: 'Hazardous Environment Suits', remaining: 117 }), [
      holder({ commodity: 'H.E. Suits', tonnes: 100 }),
      holder({ userId: 'u-b', commander: 'Brix', commodity: 'hazardous environment suits', tonnes: 17 }),
    ]);

    expect(out.held).toBe(117);
    expect(out.stillToBuy).toBe(0);
    expect(out.holders).toHaveLength(2);
    expect(
      out.commodity,
      'the row is named the way the shopping list and the market board name it',
    ).toBe('Hazardous Environment Suits');
    expect(
      out.holders.map((h) => h.commodity),
      'holder rows carry the need’s spelling, so one legend does not print two names for one thing',
    ).toEqual(['Hazardous Environment Suits', 'Hazardous Environment Suits']);
    legendAddsUp(out);
  });

  it('★ MANDATORY: a zero-tonne hold is not a holder ★', () => {
    /*
     * A Cargo snapshot is a FULL statement of a hold, so a commander who sold their Steel produces
     * a reading with no Steel in it — and, depending on how the caller assembles rows, possibly an
     * explicit zero. "CMDR Ash — 0 t" in the legend reads as "Ash has this", which is the exact
     * false reassurance that stalls a build. Negative is nonsense data and must never be allowed to
     * eat somebody else's tonnage.
     */
    const out = coverNeed(need({ remaining: 900 }), [
      holder({ userId: 'u-a', commander: 'Ash', tonnes: 0 }),
      holder({ userId: 'u-b', commander: 'Brix', tonnes: -50 }),
      holder({ userId: 'u-c', commander: 'Cass', tonnes: 300 }),
    ]);

    expect(out.holders.map((h) => h.commander)).toEqual(['Cass']);
    expect(out.held, 'the negative must not have been subtracted from Cass').toBe(300);
    expect(out.stillToBuy).toBe(600);
    legendAddsUp(out);
  });

  it('★ MANDATORY: a settled commodity still names who is carrying it ★', () => {
    /*
     * Nothing outstanding, but two commanders are holding 800 t between them. Dropping the legend
     * here would be the cruellest version of the bug: they have already bought it, and the page
     * would give them no way to discover that it is no longer wanted anywhere on this build.
     */
    const out = coverNeed(need({ remaining: 0 }), [
      holder({ userId: 'u-a', commander: 'Ash', tonnes: 500 }),
      holder({ userId: 'u-b', commander: 'Brix', tonnes: 300 }),
    ]);

    expect(out.held, 'a settled need cannot be covered any further').toBe(0);
    expect(out.stillToBuy).toBe(0);
    expect(out.heldTotal, 'the cargo is still real, and still theirs').toBe(800);
    expect(out.holders).toHaveLength(2);
    legendAddsUp(out);
  });

  it('MANDATORY: nonsense from upstream degrades to zero rather than to a negative', () => {
    // A negative `remaining` has never been seen, but "buy -400 t" is not a sentence a page may
    // ever print, and one clamp here is cheaper than trusting every caller for ever.
    const out = coverNeed(need({ remaining: -400 }), [holder({ tonnes: 200 })]);

    expect(out.remaining).toBe(0);
    expect(out.held).toBe(0);
    expect(out.stillToBuy).toBe(0);
    expect(out.heldTotal, 'the hold is still real even when the need is gibberish').toBe(200);
  });
});

describe('the legend, identical for everybody reading it', () => {
  it('★ MANDATORY: holders are ordered by tonnage, then by name — never by arrival ★', () => {
    /*
     * "Two members reading the same page must see the same list." Input order is whatever order the
     * database happened to return, which is not stable across queries, let alone across two people.
     *
     * Biggest first, because the largest holder is the one whose cargo changes a decision. Ties
     * break on the commander name and then on the user id, so the order is total: there is no pair
     * of rows whose order is left to chance.
     */
    const holders = [
      holder({ userId: 'u-c', commander: 'Cass', tonnes: 100 }),
      holder({ userId: 'u-a', commander: 'Ash', tonnes: 300 }),
      holder({ userId: 'u-b', commander: 'Brix', tonnes: 100 }),
      holder({ userId: 'u-d', commander: 'Dez', tonnes: 300 }),
    ];

    const forward = coverNeed(need({ remaining: 5_000 }), holders);
    const reversed = coverNeed(need({ remaining: 5_000 }), [...holders].reverse());

    expect(forward.holders.map((h) => h.commander)).toEqual(['Ash', 'Dez', 'Brix', 'Cass']);
    expect(
      reversed.holders.map((h) => h.commander),
      'the same holders in a different input order must produce the same legend',
    ).toEqual(['Ash', 'Dez', 'Brix', 'Cass']);
  });

  it('MANDATORY: names sort the same way in every locale', () => {
    /*
     * `localeCompare` would be the obvious tie-break and it is the wrong one: it answers differently
     * depending on the reader's browser locale, so two members would see two orders and the page
     * would have quietly broken the promise this describe block is named after. Code-unit order is
     * identical on every machine, in Electron and on the server.
     */
    const out = coverNeed(need({ remaining: 5_000 }), [
      holder({ userId: 'u-1', commander: 'Zeta', tonnes: 10 }),
      holder({ userId: 'u-2', commander: 'ash', tonnes: 10 }),
      holder({ userId: 'u-3', commander: 'Ash', tonnes: 10 }),
      holder({ userId: 'u-4', commander: 'Ärla', tonnes: 10 }),
    ]);

    // Code-unit order exactly: 'A' 65, 'Z' 90, 'a' 97, 'Ä' 196. Not alphabetical to a human, and
    // deliberately not corrected to be — the promise being kept here is sameness, not prettiness.
    expect(out.holders.map((h) => h.commander)).toEqual(['Ash', 'Zeta', 'ash', 'Ärla']);
  });

  it('★ MANDATORY: one commander’s two carriers are two rows; one carrier twice is one ★', () => {
    /*
     * The first is real: a member can have cargo aboard their ship AND parked on two of their own
     * carriers, and the owner asked for the carrier id precisely so those can be told apart.
     *
     * The second is a duplicate reaching us from upstream — two sources describing one hold, a
     * replayed journal pass, a join that fanned out. Printing "CMDR Ash — K7Q-B4L — 500 t" twice
     * both doubles the covered figure and makes the legend look like a bug, so identical holds are
     * added together into the single row a reader can actually act on.
     */
    const out = coverNeed(need({ remaining: 10_000 }), [
      holder({ userId: 'u-a', commander: 'Ash', tonnes: 500, kind: 'carrier', carrierCallsign: 'K7Q-B4L' }),
      holder({ userId: 'u-a', commander: 'Ash', tonnes: 500, kind: 'carrier', carrierCallsign: 'K7Q-B4L' }),
      holder({ userId: 'u-a', commander: 'Ash', tonnes: 200, kind: 'carrier', carrierCallsign: 'W8K-W1Y' }),
      holder({ userId: 'u-a', commander: 'Ash', tonnes: 64, kind: 'ship' }),
    ]);

    expect(out.holders).toHaveLength(3);
    expect(out.holders.map((h) => [h.carrierCallsign, h.tonnes])).toEqual([
      ['K7Q-B4L', 1_000],
      ['W8K-W1Y', 200],
      [null, 64],
    ]);
    expect(out.held).toBe(1_264);
    expect(out.carrierTonnes).toBe(1_200);
    expect(out.shipTonnes, 'the ship hold was not folded into a carrier').toBe(64);
    legendAddsUp(out);
  });
});

describe('a whole shopping list', () => {
  it('★ MANDATORY: a hold counts toward its own commodity and nothing else ★', () => {
    /*
     * The failure this guards against is a legend that reads plausibly and is wrong everywhere:
     * one bad match and every commodity on the build shows the same holders, so nobody buys
     * anything and the site stops.
     */
    const out = coverNeeds(
      [
        need({ commodity: 'Steel', remaining: 900 }),
        need({ commodity: 'Titanium', remaining: 400 }),
        need({ commodity: 'Copper', remaining: 250 }),
      ],
      [
        holder({ userId: 'u-a', commander: 'Ash', commodity: 'Steel', tonnes: 500 }),
        holder({ userId: 'u-b', commander: 'Brix', commodity: 'Titanium', tonnes: 999 }),
      ],
    );

    expect(out.map((n) => [n.commodity, n.held, n.stillToBuy])).toEqual([
      ['Steel', 500, 400],
      ['Titanium', 400, 0],
      ['Copper', 0, 250],
    ]);
    expect(out[2]?.holders, 'Copper is held by nobody, and says so').toEqual([]);
    for (const row of out) legendAddsUp(row);
  });

  it('★ MANDATORY: the caller’s order of commodities is preserved exactly ★', () => {
    /*
     * The needs list arrives already ordered by whatever the surface sorted it by — outstanding
     * tonnage, category, the member's own choice of column. Re-sorting it here would silently
     * override that on both doors, and the two doors would then disagree with the sort control the
     * member just clicked.
     */
    const commodities = ['Titanium', 'Steel', 'Copper', 'Aluminium'];
    const out = coverNeeds(commodities.map((commodity) => need({ commodity })), []);

    expect(out.map((n) => n.commodity)).toEqual(commodities);
  });

  it('MANDATORY: the list and the single row agree, so no surface can compute a different answer', () => {
    // Both doors — the website's "what it still needs" and the companion's "where to buy it" — must
    // read the same figure, and the cheapest way to guarantee that is one function underneath.
    const holders = [
      holder({ userId: 'u-a', commander: 'Ash', commodity: 'Steel', tonnes: 500 }),
      holder({ userId: 'u-b', commander: 'Brix', commodity: 'Steel', tonnes: 500 }),
      holder({ userId: 'u-c', commander: 'Cass', commodity: 'Titanium', tonnes: 90 }),
    ];
    const list = [need({ commodity: 'Steel', remaining: 900 }), need({ commodity: 'Titanium' })];

    expect(coverNeeds(list, holders)).toEqual(list.map((n) => coverNeed(n, holders)));
  });

  it('MANDATORY: an empty build is an empty list, not a thrown error', () => {
    // A project posted an hour ago whose depot has not reported yet has no needs at all. It is a
    // perfectly ordinary state and both doors render it.
    expect(coverNeeds([], [])).toEqual([]);
    expect(coverNeeds([], [holder()])).toEqual([]);
  });
});
