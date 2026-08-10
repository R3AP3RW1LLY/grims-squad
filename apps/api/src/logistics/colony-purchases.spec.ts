import { describe, expect, it } from 'vitest';
import { MAX_STOPS, planRoute, type RouteCandidate } from './colony-purchases.service.js';

/**
 * The shopping ROUTE — which stops are worth flying to, and in what order.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "the stations shown where weve bought it from should only show materials for the specific project
 * at hand, and should also only show the closet stations not every station ... also dont show
 * duplicate materials plan this so that the stations show the most matierals that can be bought for
 * the project ... we need it to work like this so we dont have people buying duplicte materials etc
 * and showing up and they already exist etc!"
 *
 * ★ THE FAILURE THIS FIXES, IN THE OWNER'S WORDS ★
 *
 * The first version was a RECORD: every station the squadron had ever bought at, with everything
 * ever bought there. As a record it is accurate. As a plan it sends four people to four stations for
 * the same Steel and a fifth for a commodity that was delivered last week — which is the exact
 * outcome the last sentence describes.
 *
 * So the ranking is pure and tested here without a database. It is the part that decides where
 * nineteen people actually fly, and it must not be reasoned about only through SQL.
 */

const NOW = new Date('2026-08-10T00:00:00Z');

/** A candidate stop. Tonnage and price play no part in the ranking, so they are held constant. */
function stop(
  stationName: string,
  distanceLy: number | null,
  commodities: readonly string[],
): RouteCandidate {
  return {
    stationName,
    systemName: `${stationName} system`,
    distanceLy,
    lines: commodities.map((commodity) => ({
      commodity,
      category: null,
      tonnes: 100,
      price: 500,
      source: 'manual' as const,
      by: 'somebody',
      at: NOW,
      note: null,
    })),
  };
}

const named = (r: { stations: readonly { stationName: string }[] }): string[] =>
  r.stations.map((s) => s.stationName);

describe('planning the shopping route', () => {
  it('★ MANDATORY: a material appears at ONE stop, never at several ★', () => {
    /*
     * The whole complaint. Three stations all stock Steel; the route names it once, so two members
     * reading the same page do not both fly for it.
     */
    const out = planRoute(new Set(['Steel', 'Titanium', 'Copper']), [
      stop('Alpha', 10, ['Steel', 'Titanium']),
      stop('Beta', 20, ['Steel', 'Copper']),
      stop('Gamma', 30, ['Steel']),
    ]);

    const everyLine = out.stations.flatMap((s) => s.lines.map((l) => l.commodity));
    expect(everyLine).toHaveLength(new Set(everyLine).size);
    expect([...everyLine].sort()).toEqual(['Copper', 'Steel', 'Titanium']);
  });

  it('★ MANDATORY: the stop that covers the most comes first, not the nearest ★', () => {
    /*
     * The owner chose this over nearest-first: "whichever station covers the most of your list".
     * Nearest-first minimises the jump to the FIRST stop and says nothing about how many stops there
     * are — a hauler would rather make one visit at 40 ly than four at 5.
     */
    const out = planRoute(new Set(['Steel', 'Titanium', 'Copper', 'Gold']), [
      stop('Nearby', 1, ['Steel']),
      stop('Far but full', 40, ['Steel', 'Titanium', 'Copper', 'Gold']),
    ]);

    expect(named(out)).toEqual(['Far but full']);
    expect(out.uncovered).toEqual([]);
  });

  it('★ MANDATORY: nothing is stocked twice, so a covered stop is not visited at all ★', () => {
    // "Nearby" has only Steel, which the first stop already covers. Flying there buys nothing.
    const out = planRoute(new Set(['Steel', 'Titanium']), [
      stop('Full', 40, ['Steel', 'Titanium']),
      stop('Nearby', 1, ['Steel']),
    ]);
    expect(named(out)).toEqual(['Full']);
  });

  it('★ MANDATORY: what nothing stocks is SAID, not quietly dropped ★', () => {
    /*
     * A route that silently omits Ceramic Composites reads as "you can buy everything here", and
     * somebody flies the whole trip and comes home still needing it.
     */
    const out = planRoute(new Set(['Steel', 'Ceramic Composites']), [stop('Alpha', 10, ['Steel'])]);

    expect(named(out)).toEqual(['Alpha']);
    expect(out.uncovered).toEqual(['Ceramic Composites']);
  });

  it('MANDATORY: distance breaks a tie, because that is the cheaper of two equal trips', () => {
    const out = planRoute(new Set(['Steel', 'Titanium']), [
      stop('Far', 90, ['Steel', 'Titanium']),
      stop('Near', 3, ['Steel', 'Titanium']),
    ]);
    expect(named(out)).toEqual(['Near']);
  });

  it('MANDATORY: a station we cannot place loses a tie rather than winning it', () => {
    /*
     * A null distance is "we do not know", and an unknown must not outrank a known 3 ly. Sorting
     * nulls first is the classic way this goes wrong.
     */
    const out = planRoute(new Set(['Steel', 'Titanium']), [
      stop('Unplaceable', null, ['Steel', 'Titanium']),
      stop('Near', 3, ['Steel', 'Titanium']),
    ]);
    expect(named(out)).toEqual(['Near']);
  });

  it('MANDATORY: it stops as soon as the list is covered — no filler stops', () => {
    const out = planRoute(new Set(['Steel']), [
      stop('Alpha', 10, ['Steel']),
      stop('Beta', 11, ['Steel']),
      stop('Gamma', 12, ['Steel']),
    ]);
    expect(out.stations).toHaveLength(1);
  });

  it('MANDATORY: it never invents a stop for something the build does not want', () => {
    // The build needs Steel. Palladium is not its problem, however much of it is out there.
    const out = planRoute(new Set(['Steel']), [
      stop('Alpha', 10, ['Steel']),
      stop('Palladium place', 2, ['Palladium']),
    ]);
    expect(named(out)).toEqual(['Alpha']);
    expect(out.stations[0]?.lines.map((l) => l.commodity)).toEqual(['Steel']);
  });

  it('MANDATORY: a route is capped, and interleaving stops does not smuggle in a longer one', () => {
    /*
     * Twenty commodities each sold at exactly one station is a twenty-stop route, which is a list
     * nobody flies. The cap keeps it to a trip; what falls past it is reported as uncovered rather
     * than dropped, so the page can say so.
     */
    const wanted = Array.from({ length: 20 }, (_, i) => `Commodity ${i}`);
    const out = planRoute(
      new Set(wanted),
      wanted.map((c, i) => stop(`Station ${i}`, i, [c])),
    );

    expect(out.stations).toHaveLength(MAX_STOPS);
    expect(out.uncovered).toHaveLength(20 - MAX_STOPS);
    expect(
      [...out.stations.flatMap((s) => s.lines.map((l) => l.commodity)), ...out.uncovered].sort(),
      'every wanted commodity is accounted for, on the route or named as off it',
    ).toEqual([...wanted].sort());
  });

  it('answers empty for a build that needs nothing', () => {
    const out = planRoute(new Set(), [stop('Alpha', 10, ['Steel'])]);
    expect(out.stations).toEqual([]);
    expect(out.uncovered).toEqual([]);
  });

  it('answers honestly when nobody has bought anything yet', () => {
    const out = planRoute(new Set(['Steel']), []);
    expect(out.stations).toEqual([]);
    expect(out.uncovered).toEqual(['Steel']);
  });

  it('lists each stop alphabetically so two people read the same order', () => {
    const out = planRoute(new Set(['Titanium', 'Copper', 'Steel']), [
      stop('Alpha', 10, ['Titanium', 'Copper', 'Steel']),
    ]);
    expect(out.stations[0]?.lines.map((l) => l.commodity)).toEqual([
      'Copper',
      'Steel',
      'Titanium',
    ]);
  });
});
