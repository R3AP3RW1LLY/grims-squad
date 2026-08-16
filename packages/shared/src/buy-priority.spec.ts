import { describe, expect, it } from 'vitest';
import { rankBuySources, type BuySource, type BuyContext } from './buy-priority.js';

/**
 * Where to send somebody to buy the rest of a build.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "on the web and in the companion app under this section: Where the squadron has bought it it must
 * always show in this priority, materials available in the system the build is happening, 2.
 * materials available in stations in systems that are architected by squadron members, 3. all other
 * locations that hold materials we can access, the priority is on orbital stations, followed by
 * ground stations. and it must always be closest to the build system!"
 *
 * ★ WHY THE ORDER IS THIS ORDER, AND NOT JUST "NEAREST" ★
 *
 * Nearest is the obvious sort and it is wrong here, because light years are not what the trip
 * actually costs.
 *
 * Buying IN the build's own system means no jump at all — load and dock. A station eight light
 * years away is not "nearly as good"; it is a return trip with a full hold, which for a Refinery
 * Hub's twenty-odd thousand tonnes is the difference between an evening and a week.
 *
 * A system a squadron member architected is the next best thing for a reason that has nothing to do
 * with distance: we control what is built there, members are already flying through it, and its
 * market is one the squadron can actually keep stocked. A neutral station of the same distance is a
 * market nobody can influence and that EDDN may be describing from four months ago.
 *
 * ★ AND ORBITAL BEFORE GROUND, WHICH IS ABOUT MINUTES, NOT MILES ★
 *
 * A ground station means a descent, a landing, a pad walk and a launch, every single run. Over a
 * twenty-run haul it dwarfs the difference between two stations a few light years apart. So it
 * outranks distance — but only WITHIN a band, because no amount of convenience makes a distant
 * orbital station beat one in the build's own system.
 */

const src = (over: Partial<BuySource> = {}): BuySource => ({
  stationName: over.stationName ?? 'Somewhere',
  systemName: over.systemName ?? 'Elsewhere',
  distanceLy: over.distanceLy === undefined ? 10 : over.distanceLy,
  isOrbital: over.isOrbital === undefined ? true : over.isOrbital,
});

const ctx = (over: Partial<BuyContext> = {}): BuyContext => ({
  buildSystem: over.buildSystem ?? 'Home',
  architectedSystems: over.architectedSystems ?? new Set(['Ours']),
});

const names = (rows: readonly BuySource[]): string[] => rows.map((r) => r.stationName);

describe('the three bands, in the owner’s order', () => {
  it('★ MANDATORY: the build’s own system comes first, however far the others are ★', () => {
    /*
     * The defining case. A station in the build system is a dock, not a trip — so it beats a closer
     * one somewhere else, and "closer" is exactly what a naive distance sort would have picked.
     */
    const out = rankBuySources(
      [
        src({ stationName: 'near-neutral', systemName: 'Elsewhere', distanceLy: 1 }),
        src({ stationName: 'in-system', systemName: 'Home', distanceLy: 0 }),
      ],
      ctx(),
    );

    expect(names(out)).toEqual(['in-system', 'near-neutral']);
  });

  it('★ MANDATORY: an architected system beats a neutral one that is nearer ★', () => {
    /*
     * Not about distance. We control what gets built in our own systems, members are already flying
     * through them, and the market is one the squadron can keep stocked — where a neutral station's
     * listing may be EDDN describing four months ago.
     */
    const out = rankBuySources(
      [
        src({ stationName: 'neutral', systemName: 'Elsewhere', distanceLy: 2 }),
        src({ stationName: 'architected', systemName: 'Ours', distanceLy: 40 }),
      ],
      ctx(),
    );

    expect(names(out)).toEqual(['architected', 'neutral']);
  });

  it('★ MANDATORY: the build system outranks an architected system too ★', () => {
    // Three bands, strictly ordered. An architected system is second, not joint-first.
    const out = rankBuySources(
      [
        src({ stationName: 'architected', systemName: 'Ours', distanceLy: 1 }),
        src({ stationName: 'in-system', systemName: 'Home', distanceLy: 0 }),
      ],
      ctx(),
    );

    expect(names(out)).toEqual(['in-system', 'architected']);
  });

  it('the build system counts as architected without being listed twice', () => {
    // A build in a system the squadron architected is the ordinary case, not an edge one. It must
    // land in the first band, not be double-counted or ranked as merely second.
    const out = rankBuySources([src({ stationName: 'here', systemName: 'Home' })], {
      buildSystem: 'Home',
      architectedSystems: new Set(['Home']),
    });

    expect(names(out)).toEqual(['here']);
  });
});

describe('orbital before ground, inside a band', () => {
  it('★ MANDATORY: an orbital station beats a ground one that is nearer ★', () => {
    /*
     * A descent, a landing, a pad walk and a launch, on every run. Over a twenty-run haul that costs
     * far more than the few light years between two stations.
     */
    const out = rankBuySources(
      [
        src({ stationName: 'ground', isOrbital: false, distanceLy: 3 }),
        src({ stationName: 'orbital', isOrbital: true, distanceLy: 12 }),
      ],
      ctx(),
    );

    expect(names(out)).toEqual(['orbital', 'ground']);
  });

  it('★ MANDATORY: but it never beats a nearer BAND ★', () => {
    /*
     * The ordering that would be wrong if convenience were applied globally: a ground station in the
     * build's own system is still a dock with no jump, and it beats an orbital station light years
     * away. Bands first, then convenience, then distance.
     */
    const out = rankBuySources(
      [
        src({ stationName: 'far-orbital', systemName: 'Elsewhere', isOrbital: true, distanceLy: 5 }),
        src({ stationName: 'home-ground', systemName: 'Home', isOrbital: false, distanceLy: 0 }),
      ],
      ctx(),
    );

    expect(names(out)).toEqual(['home-ground', 'far-orbital']);
  });

  it('an unknown station kind sorts with ground, not with orbital', () => {
    /*
     * Guessing generously would send somebody on a descent they were told they would not make. The
     * cost of being wrong is asymmetric, so the unknown takes the pessimistic side.
     */
    const out = rankBuySources(
      [
        src({ stationName: 'unknown', isOrbital: null, distanceLy: 1 }),
        src({ stationName: 'orbital', isOrbital: true, distanceLy: 9 }),
      ],
      ctx(),
    );

    expect(names(out)).toEqual(['orbital', 'unknown']);
  });
});

describe('closest first, once everything else ties', () => {
  it('★ MANDATORY: distance decides within a band and kind ★', () => {
    const out = rankBuySources(
      [
        src({ stationName: 'far', distanceLy: 30 }),
        src({ stationName: 'near', distanceLy: 3 }),
        src({ stationName: 'middle', distanceLy: 11 }),
      ],
      ctx(),
    );

    expect(names(out)).toEqual(['near', 'middle', 'far']);
  });

  it('★ MANDATORY: an unplaceable station sorts last, never first ★', () => {
    /*
     * `distanceLy` is null when we cannot place one end of the trip. In JavaScript a null in a
     * numeric sort compares as zero, which would silently promote every station we know least about
     * to the top of the list the owner asked to be ordered by closeness.
     */
    const out = rankBuySources(
      [
        src({ stationName: 'unplaceable', distanceLy: null }),
        src({ stationName: 'far', distanceLy: 200 }),
      ],
      ctx(),
    );

    expect(names(out)).toEqual(['far', 'unplaceable']);
  });

  it('the order is stable for genuine ties, so the list does not shuffle on refresh', () => {
    // A list that reorders itself between two identical reads reads as data changing when nothing
    // has, and a member re-checking a route would not trust it.
    const rows = [
      src({ stationName: 'a', distanceLy: 5 }),
      src({ stationName: 'b', distanceLy: 5 }),
      src({ stationName: 'c', distanceLy: 5 }),
    ];

    expect(names(rankBuySources(rows, ctx()))).toEqual(['a', 'b', 'c']);
    expect(names(rankBuySources(rows, ctx()))).toEqual(['a', 'b', 'c']);
  });
});

describe('what it does not do', () => {
  it('MANDATORY: it does not drop anything', () => {
    /*
     * Ranking, never filtering. A station that ranks last is still somewhere a member could go, and
     * a list that silently omitted the only stop holding one commodity would send them home empty.
     */
    const rows = [
      src({ stationName: 'a', systemName: 'Home' }),
      src({ stationName: 'b', systemName: 'Ours' }),
      src({ stationName: 'c', systemName: 'Nowhere', distanceLy: null }),
    ];

    expect(rankBuySources(rows, ctx())).toHaveLength(3);
  });

  it('MANDATORY: it does not mutate what it was given', () => {
    // The caller's array is React state on both surfaces. Sorting in place is how a list re-renders
    // into a different order than the one that was rendered from.
    const rows = [src({ stationName: 'far', distanceLy: 30 }), src({ stationName: 'near', distanceLy: 1 })];

    rankBuySources(rows, ctx());
    expect(names(rows)).toEqual(['far', 'near']);
  });

  it('system names are matched without case tripping them up', () => {
    // Elite's own spelling varies by source: EDDN, Inara and a member typing it are three different
    // capitalisations of one system, and a case-sensitive match would drop the build's own system
    // out of the first band entirely.
    const out = rankBuySources([src({ stationName: 'here', systemName: 'HOME', distanceLy: 50 })], {
      buildSystem: 'Home',
      architectedSystems: new Set<string>(),
    });

    expect(names(out)).toEqual(['here']);
    expect(rankBuySources(
      [
        src({ stationName: 'other', systemName: 'Elsewhere', distanceLy: 1 }),
        src({ stationName: 'here', systemName: 'HOME', distanceLy: 50 }),
      ],
      { buildSystem: 'home', architectedSystems: new Set<string>() },
    ).map((r) => r.stationName)).toEqual(['here', 'other']);
  });
});
