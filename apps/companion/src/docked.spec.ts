import { describe, it, expect } from 'vitest';
import {
  trackDocked,
  isFresh,
  seedFromJournal,
  mergeDock,
  projectTitleFrom,
  DOCK_FRESH_MS,
  type DockedAt,
  type ParsedLike,
} from './docked.js';

/**
 * Knowing where the commander is docked, so the app can fill a form in for them.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "it should appear automatically in the companion app on the new project page if it is not being
 * used please!" — of the market id, which the form had been asking a member to find and retype.
 *
 * The failure this guards is specific and quiet: a market id is the JOIN TO REALITY for a project.
 * Get it wrong and the project sits on the board looking fine and silently never updates, because
 * no journal event will ever match it. So a wrong answer here is worse than no answer, and every
 * test below is a way of getting it wrong.
 */

const ev = (name: string, data: Record<string, unknown>, at = '2026-08-02T10:00:00Z'): ParsedLike => ({
  name,
  occurredAt: at,
  data,
});

const DOCKED = ev('Docked', {
  MarketID: 3_706_117_632,
  StationName: 'Ambrose Dock',
  StarSystem: 'HIP 58832',
});

describe('tracking where somebody is docked', () => {
  it('reads a Docked event', () => {
    expect(trackDocked(null, [DOCKED])).toEqual({
      marketId: '3706117632',
      stationName: 'Ambrose Dock',
      systemName: 'HIP 58832',
      at: '2026-08-02T10:00:00Z',
      // No depot heartbeat has named this market, so nothing is known about it as a build site.
      // An ordinary station stays null here for ever, which is correct.
      site: null,
    });
  });

  it('MANDATORY: keeps the market id exact', () => {
    /*
     * Ids are large and are the join to reality. A rounded or exponential one produces a project
     * that never matches a journal event — a board entry that looks fine and never updates.
     */
    const seen = trackDocked(null, [ev('Docked', {
      MarketID: 3_706_117_632,
      StationName: 'X',
      StarSystem: 'Y',
    })]);

    expect(seen?.marketId).toBe('3706117632');
    expect(seen?.marketId).not.toMatch(/[eE+.]/);
  });

  it('accepts an id that arrives as a string', () => {
    const seen = trackDocked(null, [ev('Docked', {
      MarketID: '3706117632',
      StationName: 'X',
      StarSystem: 'Y',
    })]);
    expect(seen?.marketId).toBe('3706117632');
  });

  it('MANDATORY: ignores a half-event rather than replacing a good one', () => {
    // An id with no name cannot be shown; a name with no id cannot be posted. Either way the old
    // value is more useful than a broken new one.
    const before = trackDocked(null, [DOCKED]);

    expect(trackDocked(before, [ev('Docked', { StationName: 'No id here' })])).toEqual(before);
    expect(trackDocked(before, [ev('Docked', { MarketID: 42 })])).toEqual(before);
  });

  it('takes the LAST dock in a batch', () => {
    // A pass can cover several minutes of journal. The newest is where they are.
    const second = ev('Docked', { MarketID: 99, StationName: 'Second', StarSystem: 'Z' });
    expect(trackDocked(null, [DOCKED, second])?.stationName).toBe('Second');
  });

  it('remembers across passes, because nothing repeats the station', () => {
    // Somebody docks in one twenty-second window and posts a project ten minutes later. Nothing in
    // between mentions the station again.
    const before = trackDocked(null, [DOCKED]);
    expect(trackDocked(before, [ev('Scan', {}), ev('Music', {})])).toEqual(before);
  });
});

describe('leaving', () => {
  it('MANDATORY: Undocked clears it', () => {
    /*
     * Without this the app keeps claiming a member is at a station they left an hour ago, and
     * pre-fills the project form with the wrong site.
     */
    const before = trackDocked(null, [DOCKED]);
    expect(trackDocked(before, [ev('Undocked', {})])).toBeNull();
  });

  it('MANDATORY: an FSD jump clears it too', () => {
    /*
     * A journal can be missing the Undocked — the app may have started mid-session, or the event
     * may sit in a chunk never read. Arriving in another system is unambiguous.
     */
    const before = trackDocked(null, [DOCKED]);
    expect(trackDocked(before, [ev('FSDJump', { StarSystem: 'Somewhere else' })])).toBeNull();
  });

  it('MANDATORY: Location does NOT clear it', () => {
    /*
     * `Location` fires on logging in and carries `Docked: true` when a member resumes at a station.
     * Treating it as a departure would forget where somebody is every time they start the game —
     * which is exactly when they are most likely to want the form filled in.
     */
    const before = trackDocked(null, [DOCKED]);
    const resumed = trackDocked(before, [
      ev('Location', {
        Docked: true,
        MarketID: 3_706_117_632,
        StationName: 'Ambrose Dock',
        StarSystem: 'HIP 58832',
      }),
    ]);

    expect(resumed?.marketId).toBe('3706117632');
  });

  it('a Location that is NOT docked leaves the old value alone', () => {
    // Logging in in open space says nothing about a station. It is neither an arrival nor a
    // departure, and inventing either would be a guess.
    const before = trackDocked(null, [DOCKED]);
    expect(trackDocked(before, [ev('Location', { Docked: false, StarSystem: 'Deep space' })])).toEqual(
      before,
    );
  });
});

describe('how fresh a dock is', () => {
  const NOW = Date.parse('2026-08-02T12:00:00Z');
  const at = (iso: string): DockedAt => ({
    marketId: '1',
    stationName: 'X',
    systemName: 'Y',
    at: iso,
    site: null,
  });

  it('accepts one from this session', () => {
    expect(isFresh(at('2026-08-02T11:30:00Z'), NOW)).toBe(true);
  });

  it('MANDATORY: refuses a stale one', () => {
    /*
     * The app may have been closed for days with a Docked as the last thing it saw. Pre-filling a
     * form with a station somebody left on Tuesday creates a project pointing at the wrong site —
     * and it would silently never update, which reads as the sync being broken.
     */
    expect(isFresh(at('2026-07-28T09:00:00Z'), NOW)).toBe(false);
    expect(isFresh(at(new Date(NOW - DOCK_FRESH_MS - 1000).toISOString()), NOW)).toBe(false);
  });

  it('refuses a timestamp from the future', () => {
    // A clock disagreement, not a fresh dock.
    expect(isFresh(at('2026-08-03T12:00:00Z'), NOW)).toBe(false);
  });

  it('tolerates a small clock skew', () => {
    // The game's clock and ours differing by minutes is normal and harmless.
    expect(isFresh(at(new Date(NOW + 60_000).toISOString()), NOW)).toBe(true);
  });

  it('refuses nothing, and refuses nonsense', () => {
    expect(isFresh(null, NOW)).toBe(false);
    expect(isFresh(at('not a date'), NOW)).toBe(false);
  });
});

/**
 * The construction-site heartbeat.
 *
 * ★ REPORTED FROM A LIVE GAME, 2026-08-02 ★
 *
 * "i am currently in game, i am in the colonization window in the companion app, however, nothing at
 * all is auto populating!"
 *
 * Their journal said why, precisely: `Docked` at 17:33:08 and already behind the app's saved offset
 * of 211,038 bytes, while `ColonisationConstructionDepot` fired at 17:45:12 and every fifteen
 * seconds before it. Watching only the arrival meant watching the one event that had already gone.
 *
 * The events below are that journal's real shapes.
 */
describe('a construction site', () => {
  const DEPOT = ev('ColonisationConstructionDepot', {
    MarketID: 4_359_491_587,
    ConstructionProgress: 0.421_395,
    ConstructionComplete: false,
    ConstructionFailed: false,
    ResourcesRequired: [
      { Name: '$aluminium_name;', Name_Localised: 'Aluminium', RequiredAmount: 42_282, ProvidedAmount: 16_526 },
      { Name: '$ceramiccomposites_name;', Name_Localised: 'Ceramic Composites', RequiredAmount: 4_884, ProvidedAmount: 4_884 },
    ],
  }, '2026-08-02T17:45:12Z');

  const ARRIVED = ev('Docked', {
    MarketID: 4_359_491_587,
    StationName: "Planetary Construction Site: Harry's Dysfunctional Society",
    StationType: 'PlanetaryConstructionDepot',
    StarSystem: 'Hyades Sector XJ-Z c18',
  }, '2026-08-02T17:33:08Z');

  it('MANDATORY: recognises the site from the depot alone', () => {
    /*
     * The whole bug. With no `Docked` in the events we can still see — because it was consumed
     * before the feature existed — the heartbeat has to be enough to know where the member is.
     */
    const seen = trackDocked(null, [DEPOT]);

    expect(seen?.marketId).toBe('4359491587');
    expect(seen?.site?.resources).toHaveLength(2);
  });

  it('reads everything about the site', () => {
    // "it should read all data about the site and populate the new project window."
    const site = trackDocked(null, [DEPOT])?.site;

    expect(site?.progress).toBeCloseTo(0.421_395);
    expect(site?.complete).toBe(false);
    expect(site?.resources[0]).toEqual({
      commodity: 'Aluminium',
      required: 42_282,
      provided: 16_526,
    });
  });

  it('MANDATORY: uses the localised name, which is what the market joins on', () => {
    // `$aluminium_name;` would match nothing in market_entries, and the shopping list would come
    // back silently empty.
    expect(trackDocked(null, [DEPOT])?.site?.resources.map((r) => r.commodity)).toEqual([
      'Aluminium',
      'Ceramic Composites',
    ]);
  });

  it('keeps the station name when the arrival IS known', () => {
    // Docked first, then heartbeats. The name comes from the arrival and must survive them.
    const seen = trackDocked(null, [ARRIVED, DEPOT]);

    expect(seen?.stationName).toBe("Planetary Construction Site: Harry's Dysfunctional Society");
    expect(seen?.systemName).toBe('Hyades Sector XJ-Z c18');
    expect(seen?.site?.resources).toHaveLength(2);
  });

  it('MANDATORY: the heartbeat keeps the dock fresh', () => {
    /*
     * A member sitting at a site for hours must not age out of the freshness window while they are
     * still standing there. The depot's timestamp is the one that counts, not the arrival's.
     */
    const seen = trackDocked(null, [ARRIVED, DEPOT]);
    expect(seen?.at).toBe('2026-08-02T17:45:12Z');
  });

  it('MANDATORY: drops a name that belongs to a different station', () => {
    // A heartbeat from another market means the remembered identity is stale. Carrying the old name
    // onto a new id would put the wrong station on a project.
    const elsewhere = ev('ColonisationConstructionDepot', { MarketID: 111, ResourcesRequired: [] });
    const seen = trackDocked(trackDocked(null, [ARRIVED]), [elsewhere]);

    expect(seen?.marketId).toBe('111');
    expect(seen?.stationName).toBe('');
  });

  it('keeps the site detail across a re-dock at the same market', () => {
    // Undock and dock again at the same site: the arrival must not blank out what the heartbeat
    // already told us.
    const withSite = trackDocked(null, [DEPOT]);
    expect(trackDocked(withSite, [ARRIVED])?.site?.resources).toHaveLength(2);
  });
});

describe('seeding from a journal on startup', () => {
  it('MANDATORY: recovers a dock the watcher already consumed', () => {
    /*
     * The exact failure. The watcher reads forward from a byte offset, so an arrival before that
     * offset is gone for ever — and waiting for the member to undock and dock again is not a fix.
     */
    const journal = [
      JSON.stringify({ timestamp: '2026-08-02T17:33:08Z', event: 'Docked', MarketID: 4_359_491_587, StationName: 'Site', StarSystem: 'Hyades' }),
      JSON.stringify({ timestamp: '2026-08-02T17:45:12Z', event: 'ColonisationConstructionDepot', MarketID: 4_359_491_587, ConstructionProgress: 0.42, ResourcesRequired: [] }),
    ].join('\n');

    const seeded = seedFromJournal(journal);

    expect(seeded?.marketId).toBe('4359491587');
    expect(seeded?.stationName).toBe('Site');
  });

  it('survives the half-line a tail read always starts with', () => {
    // Reading from a byte offset lands mid-line. Expected, not an error — and the reason the tail
    // read is generous.
    const journal = ['ationName": "cut off"}', JSON.stringify({ timestamp: '2026-08-02T17:33:08Z', event: 'Docked', MarketID: 7, StationName: 'Fine', StarSystem: 'X' })].join('\n');

    expect(seedFromJournal(journal)?.stationName).toBe('Fine');
  });

  it('says nothing when the tail holds nothing relevant', () => {
    const journal = [JSON.stringify({ timestamp: '2026-08-02T17:00:00Z', event: 'Music', MusicTrack: 'NoTrack' })].join('\n');
    expect(seedFromJournal(journal)).toBeNull();
  });

  it('honours an undock that happened after the arrival', () => {
    // The tail is replayed through the same rules as the live path, so leaving still means leaving.
    const journal = [
      JSON.stringify({ timestamp: '2026-08-02T17:33:08Z', event: 'Docked', MarketID: 7, StationName: 'Site', StarSystem: 'X' }),
      JSON.stringify({ timestamp: '2026-08-02T17:50:00Z', event: 'Undocked' }),
    ].join('\n');

    expect(seedFromJournal(journal)).toBeNull();
  });
});


describe('naming a project from the station', () => {
  it('MANDATORY: drops Frontier class prefixes', () => {
    /*
     * "it should auto complete what to call it based on the site name excluding thisng like this
     * Planetary Construction Site:" — the real name from the owner's own journal.
     */
    expect(projectTitleFrom("Planetary Construction Site: Harry's Dysfunctional Society")).toBe(
      "Harry's Dysfunctional Society",
    );
    expect(projectTitleFrom('Orbital Construction Site: Ambrose Dock')).toBe('Ambrose Dock');
    expect(projectTitleFrom('Construction Site: Somewhere')).toBe('Somewhere');
  });

  it('MANDATORY: leaves a station whose name merely contains a colon', () => {
    // Frontier names are stranger than any rule. An over-eager split would silently halve one.
    expect(projectTitleFrom('Ridley Scott: Prospect')).toBe('Ridley Scott: Prospect');
    expect(projectTitleFrom('Jameson Memorial')).toBe('Jameson Memorial');
  });

  it('keeps the whole thing when nothing follows the prefix', () => {
    expect(projectTitleFrom('Planetary Construction Site:')).toBe('Planetary Construction Site:');
  });

  it('gives back nothing for nothing', () => {
    expect(projectTitleFrom('')).toBe('');
    expect(projectTitleFrom('   ')).toBe('');
  });
});

describe('merging the seed with the live pass', () => {
  const heartbeatOnly: DockedAt = {
    marketId: '4359491587',
    stationName: '',
    systemName: '',
    at: '2026-08-02T17:45:12Z',
    site: { progress: 0.42, complete: false, failed: false, resources: [] },
  };

  const fromSeed: DockedAt = {
    marketId: '4359491587',
    stationName: "Planetary Construction Site: Harry's Dysfunctional Society",
    systemName: 'Hyades Sector XJ-Z c18',
    at: '2026-08-02T17:33:08Z',
    site: null,
  };

  it('MANDATORY: fills in the name the heartbeat cannot know', () => {
    /*
     * The reported bug. The depot heartbeat carries only a market id, so the live path produces a
     * real dock with no name — and an all-or-nothing seed declined to help, leaving the form with
     * an id and two empty boxes.
     */
    const merged = mergeDock(heartbeatOnly, fromSeed);

    expect(merged?.marketId).toBe('4359491587');
    expect(merged?.stationName).toBe("Planetary Construction Site: Harry's Dysfunctional Society");
    expect(merged?.systemName).toBe('Hyades Sector XJ-Z c18');
  });

  it('keeps the heartbeat freshness and site data', () => {
    // The seed is a snapshot of the past; the heartbeat is fifteen seconds old at worst.
    const merged = mergeDock(heartbeatOnly, fromSeed);

    expect(merged?.at).toBe('2026-08-02T17:45:12Z');
    expect(merged?.site?.progress).toBeCloseTo(0.42);
  });

  it('MANDATORY: refuses a name from a station the member has left', () => {
    // Different market: the live answer wins outright, blank name and all. A stale name on a fresh
    // id would put the wrong station on a project.
    const elsewhere = { ...heartbeatOnly, marketId: '999' };
    expect(mergeDock(elsewhere, fromSeed)?.stationName).toBe('');
  });

  it('never lets the seed overrule a name the live pass has', () => {
    const named = { ...heartbeatOnly, stationName: 'Live name', systemName: 'Live system' };
    const merged = mergeDock(named, fromSeed);

    expect(merged?.stationName).toBe('Live name');
    expect(merged?.systemName).toBe('Live system');
  });

  it('handles either side being absent', () => {
    expect(mergeDock(null, fromSeed)).toEqual(fromSeed);
    expect(mergeDock(heartbeatOnly, null)).toEqual(heartbeatOnly);
    expect(mergeDock(null, null)).toBeNull();
  });
});
