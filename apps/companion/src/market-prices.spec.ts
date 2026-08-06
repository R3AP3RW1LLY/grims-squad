import { describe, expect, it } from 'vitest';
import { withMarketPrices } from './market-prices.js';

/**
 * Attaching a station's prices to the journal event that announced it.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "nothing happens when someone lands here and opens the commodities market, they are supposed to
 * be credited on the leaderboard with the points etc ... none of this is working!"
 *
 * They were right, and it had never worked once. Production: 1,092 `Market` events received, ZERO
 * market rows from the journal, ZERO bounty claims ever.
 *
 * ★ THE JOURNAL'S `Market` EVENT HAS NO PRICES IN IT ★
 *
 * Frontier writes it as a five-field announcement — timestamp, event, MarketID, StationName,
 * StarSystem — and puts the commodity list in a SEPARATE file, `Market.json`, rewritten each time
 * a market screen is opened.
 *
 * The server's `applySnapshot` returns 0 the moment `Items` is missing, so no market row was ever
 * written from a member's upload, so `awardBounty` — which only runs when rows were written — was
 * never once reached. Every link in the chain was correct and the first one had no data.
 *
 * ★ AND THE FILE WAS DELIBERATELY OFF LIMITS ★
 *
 * `journal-paths.spec` asserted the app ignores Market.json: "the app says it reads the journal, so
 * it reads the journal". That promise was kept and the feature built on top of it could not work.
 * The squadron owner chose to read the file and change the promise openly rather than leave a
 * leaderboard that credits nobody.
 *
 * ★ THE MARKET ID IS CHECKED, AND THAT IS THE WHOLE SAFETY OF THIS ★
 *
 * Market.json holds ONE market — the last one opened — and is overwritten. When the app catches up
 * on an old journal, or a member docks somewhere else while a batch is in flight, the file on disk
 * describes a DIFFERENT station than the event being processed. Attaching those prices would
 * publish one station's prices under another station's name, to the whole squadron, as fact.
 *
 * So the ids must match, and when they do not the event is sent exactly as it was.
 */

const MARKET_EVENT = {
  timestamp: '2026-08-06T15:00:00Z',
  event: 'Market',
  MarketID: 3229033472,
  StationName: 'Jameson Memorial',
  StarSystem: 'Shinrarta Dezhra',
};

const MARKET_JSON = JSON.stringify({
  timestamp: '2026-08-06T15:00:00Z',
  event: 'Market',
  MarketID: 3229033472,
  StationName: 'Jameson Memorial',
  StarSystem: 'Shinrarta Dezhra',
  Items: [
    { Name: '$gold_name;', Name_Localised: 'Gold', BuyPrice: 9000, Stock: 500, Demand: 0 },
    { Name: '$silver_name;', Name_Localised: 'Silver', BuyPrice: 4000, Stock: 200, Demand: 0 },
  ],
});

describe('the prices reach the event that announced them', () => {
  it('MANDATORY: Items are attached when the market ids agree', () => {
    const merged = withMarketPrices(MARKET_EVENT, MARKET_JSON);

    expect(Array.isArray(merged['Items']), 'no prices were attached, so no bounty can ever pay').toBe(true);
    expect((merged['Items'] as unknown[]).length).toBe(2);
  });

  it('MANDATORY: everything the journal said is preserved', () => {
    /*
     * The station name and system are what create an unknown station server-side. Replacing the
     * event with the file's copy would usually be identical and would silently stop being so the
     * day Frontier changes one of them.
     */
    const merged = withMarketPrices(MARKET_EVENT, MARKET_JSON);

    expect(merged['MarketID']).toBe(3229033472);
    expect(merged['StationName']).toBe('Jameson Memorial');
    expect(merged['StarSystem']).toBe('Shinrarta Dezhra');
    expect(merged['event']).toBe('Market');
  });
});

describe('one station’s prices are never published under another station’s name', () => {
  it('MANDATORY: a mismatched market id attaches nothing', () => {
    /*
     * The dangerous case, and the reason this function exists rather than a two-line merge at the
     * call site. Market.json holds only the LAST market opened. Catching up on an old journal, or
     * docking again while a batch is in flight, means the file describes a different station.
     */
    const elsewhere = JSON.stringify({
      event: 'Market',
      MarketID: 999999999,
      StationName: 'Somewhere Else',
      Items: [{ Name: '$gold_name;', Name_Localised: 'Gold', BuyPrice: 1, Stock: 1, Demand: 0 }],
    });

    const merged = withMarketPrices(MARKET_EVENT, elsewhere);

    expect(
      merged['Items'],
      'prices from a different station were attached — the squadron would be told these are this station’s prices',
    ).toBeUndefined();
  });

  it('MANDATORY: a string market id still matches its number', () => {
    // A journal that has been through a JSON round trip can carry either. Refusing the match would
    // silently disable the feature for those members.
    const asString = JSON.stringify({ event: 'Market', MarketID: '3229033472', Items: [{ Name: 'x' }] });

    expect(withMarketPrices(MARKET_EVENT, asString)['Items']).toBeDefined();
  });
});

describe('a missing or broken file is normal, not a failure', () => {
  it('MANDATORY: no file at all returns the event untouched', () => {
    /*
     * A member who has never opened a market screen has no Market.json, and every journal event
     * that is not a Market passes through here in the ordinary course of things.
     */
    expect(withMarketPrices(MARKET_EVENT, null)['Items']).toBeUndefined();
  });

  it('MANDATORY: unparseable JSON returns the event untouched', () => {
    // The file is rewritten while the game runs, so a read can catch it half-written.
    expect(withMarketPrices(MARKET_EVENT, '{"Items": [')['Items']).toBeUndefined();
  });

  it('MANDATORY: a file with no Items attaches nothing rather than an empty list', () => {
    /*
     * An empty `Items` would REPLACE the station's whole market with nothing server-side — the
     * snapshot path deletes every row for the station before inserting what it was given.
     */
    const noItems = JSON.stringify({ event: 'Market', MarketID: 3229033472, Items: [] });

    expect(withMarketPrices(MARKET_EVENT, noItems)['Items']).toBeUndefined();
  });

  it('does not touch events that are not Market', () => {
    const docked = { event: 'Docked', MarketID: 3229033472, StationName: 'Jameson Memorial' };

    expect(withMarketPrices(docked, MARKET_JSON)['Items']).toBeUndefined();
  });
});
