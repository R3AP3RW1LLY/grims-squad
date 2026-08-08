import { describe, expect, it } from 'vitest';
import { readDockSighting, readSystemSighting } from './sightings.js';

/**
 * Reading a journal event for what it says about the galaxy.
 *
 * ★ WHY THESE EXIST AT ALL ★
 *
 * `enrichStationFromDock` was written weeks before this, complete and correct, and called by
 * nothing. `Docked` was never routed to it, and the field allowlist discarded `MarketID` before it
 * could have been — so 987 docks in a week taught the platform nothing and a member opening a new
 * station stayed invisible until EDDN caught up.
 *
 * The lesson is not "write more code", it is that a parser and a writer with no test between them
 * can both be right while the feature does nothing. These are the cases that decide whether an
 * event turns into a row.
 */

describe('reading a system out of a jump', () => {
  it('takes the name, the address and the coordinates', () => {
    const seen = readSystemSighting({
      StarSystem: 'Col 285 Sector GL-W c2-12',
      SystemAddress: 3382588805794,
      StarPos: [108.1875, 55.1875, -236.125],
      SystemAllegiance: 'Federation',
      Population: 5374133117,
    });

    expect(seen?.systemName).toBe('Col 285 Sector GL-W c2-12');
    // INV-006: a 64-bit address is a string, never a number.
    expect(seen?.systemAddress).toBe('3382588805794');
    expect(seen?.coords).toEqual([108.1875, 55.1875, -236.125]);
    expect(seen?.allegiance).toBe('Federation');
    expect(seen?.population).toBe(5374133117);
  });

  it('accepts an address that has been through JSON storage as a string', () => {
    // Backfill reads payloads back out of jsonb, where a big integer may arrive either way.
    const seen = readSystemSighting({ StarSystem: 'Sol', SystemAddress: '10477373803' });
    expect(seen?.systemAddress).toBe('10477373803');
  });

  it('keeps a sighting that has no coordinates at all', () => {
    /*
     * A `Location` on a session that began docked carries no StarPos. A name and an address are
     * still worth having: they are enough to stop the scout telling somebody to check the spelling
     * of a system they are standing in.
     */
    const seen = readSystemSighting({ StarSystem: 'Deciat', SystemAddress: 6681123623626 });
    expect(seen).not.toBeNull();
    expect(seen?.coords).toBeNull();
  });

  it('★ MANDATORY: refuses a partial coordinate rather than placing the system wrongly ★', () => {
    /*
     * One non-finite entry makes the whole triple useless. A cube() carrying a NaN would put the
     * system somewhere no distance query could answer sensibly — which is worse than no
     * coordinates, because it looks like an answer.
     */
    for (const pos of [[1, 2], [1, 2, Number.NaN], [1, 2, 'x'], 'nope', null]) {
      const seen = readSystemSighting({ StarSystem: 'X', SystemAddress: 1, StarPos: pos });
      expect(seen?.coords, `StarPos ${JSON.stringify(pos)} should not have been accepted`).toBeNull();
    }
  });

  it('returns nothing when the event cannot name or address a system', () => {
    expect(readSystemSighting({ StarPos: [1, 2, 3] })).toBeNull();
    expect(readSystemSighting({ StarSystem: 'Sol' })).toBeNull();
  });
});

describe('reading a station out of a dock', () => {
  it('takes the identity, the pads and the arrival distance', () => {
    const dock = readDockSighting({
      MarketID: 3706117632,
      StationName: "Karlsefni's Progress",
      StarSystem: 'HR 2340',
      SystemAddress: 147933104475,
      StationType: 'Orbis',
      DistFromStarLS: 261.4,
      LandingPads: { Small: 4, Medium: 8, Large: 6 },
    });

    expect(dock?.marketId).toBe(3706117632);
    expect(dock?.largePads).toBe(6);
    expect(dock?.distFromStarLs).toBe(261.4);
  });

  it('★ MANDATORY: unknown pads are null, never zero ★', () => {
    /*
     * The rule `ensureLiveStation` already states: a count we cannot vouch for must stay
     * distinguishable from a genuine zero, so a page can say "pads unknown" rather than lie in
     * either direction. Zero here would read as "no large pads" and quietly hide the station from
     * every large-pad search.
     */
    const dock = readDockSighting({
      MarketID: 1,
      StationName: 'Somewhere',
      StarSystem: 'Sol',
    });

    expect(dock?.largePads).toBeNull();
    expect(dock?.largePads).not.toBe(0);
  });

  it('reads a genuine zero as zero', () => {
    const dock = readDockSighting({
      MarketID: 1,
      StationName: 'Outpost',
      StarSystem: 'Sol',
      LandingPads: { Small: 2, Medium: 1, Large: 0 },
    });

    expect(dock?.largePads).toBe(0);
  });

  it('refuses a dock with no market id, because that is the station’s identity', () => {
    /*
     * Unlike coordinates, this one is not optional. The market id is the only key every source
     * shares and no station ever changes; without it a sighting would create a second identity for
     * the same place and its market rows would split across both.
     */
    expect(readDockSighting({ StationName: 'Somewhere', StarSystem: 'Sol' })).toBeNull();
  });

  it('survives the trimmed payloads already sitting in production', () => {
    // Exactly what a stored Docked row looked like before the allowlist was widened.
    const dock = readDockSighting({
      StarSystem: 'HR 2340',
      StationName: "Karlsefni's Progress",
      StationType: 'Orbis',
      StationFaction: { Name: 'Juro Collective' },
    });

    // No MarketID, so it cannot be used — and says so rather than inventing an identity.
    expect(dock).toBeNull();
  });
});
