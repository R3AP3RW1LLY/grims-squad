import { describe, expect, it } from 'vitest';
import {
  readTradePlan,
  readPlanOrigin,
  writeTradePlan,
  whereInPlan,
  type PickedRun,
} from './trade-plan.js';

/**
 * The run a member picked, carried from the window to the overlay.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "add an option to choose the trade route and display them in the overlay please so we can group
 * multiple routes together if there are several that are going to the same destination, and show
 * the optimized order ... add a clickable picker icon to each traderoute"
 *
 * ★ THE OVERLAY PANEL HAS SAID "PICK A RUN" SINCE IT WAS WRITTEN ★
 *
 * There was no record anywhere of what a member chose — the Freight Office computed candidates and
 * forgot them the moment the page changed. This is that record.
 */

const RUN: PickedRun = {
  commodity: 'Gold',
  buyStation: 'Jameson Memorial',
  buySystem: 'Shinrarta Dezhra',
  sellStation: 'Ray Gateway',
  sellSystem: 'Diaguandri',
  buyPrice: 9000,
  profitPerTonne: 11000,
  supply: 5000,
  demand: 8000,
  buyDistanceLy: 0,
  buyCoords: { x: 55.7, y: 17.6, z: 27.2 },
};

describe('storing the picked run', () => {
  it('round-trips a plan through the string the config holds', () => {
    const json = writeTradePlan([RUN]);
    expect(readTradePlan(json)).toEqual([RUN]);
  });

  it('reads nothing from nothing, rather than throwing', () => {
    /*
     * A member who has never picked a run, and a config file from before this existed, both land
     * here. The overlay's own empty sentence is the right answer — a crash on startup is not.
     */
    expect(readTradePlan(null)).toEqual([]);
    expect(readTradePlan('')).toEqual([]);
    expect(readTradePlan('not json at all')).toEqual([]);
    expect(readTradePlan('{"picks":"wrong shape"}')).toEqual([]);
  });

  it('drops a run missing the parts a manifest cannot do without', () => {
    // A half-written pick would plan a stop with no station name and send somebody nowhere.
    const json = JSON.stringify({ picks: [{ commodity: 'Gold' }, RUN] });
    expect(readTradePlan(json)).toEqual([RUN]);
  });

  it('survives a config written by a newer version carrying fields we do not know', () => {
    const json = JSON.stringify({ picks: [{ ...RUN, somethingNew: 42 }], version: 99 });
    const [back] = readTradePlan(json);
    expect(back?.commodity).toBe('Gold');
  });
});

describe('where the member is in the plan', () => {
  /** The next leg of a chain: loads where the first one sells, and carries on somewhere else. */
  const SECOND: PickedRun = {
    ...RUN,
    commodity: 'Palladium',
    buyStation: 'Ray Gateway',
    buySystem: 'Diaguandri',
    sellStation: 'Dubyago Orbital',
    sellSystem: 'LHS 3447',
  };

  it('knows when you are standing at a pickup', () => {
    const at = whereInPlan([RUN, SECOND], {
      stationName: 'Jameson Memorial',
      systemName: 'Shinrarta Dezhra',
    });

    expect(at.loadHere.map((p) => p.commodity)).toEqual(['Gold']);
    expect(at.sellHere).toHaveLength(0);
  });

  it('knows when you are standing at a sale', () => {
    const at = whereInPlan([RUN], {
      stationName: 'Ray Gateway',
      systemName: 'Diaguandri',
    });

    expect(at.sellHere.map((p) => p.commodity)).toEqual(['Gold']);
    expect(at.loadHere).toHaveLength(0);
  });

  it('reports both when one station is a sale and the next pickup', () => {
    /*
     * ★ THE CASE THE OWNER ASKED FOR ★
     *
     * "group multiple routes together if there are several that are going to the same destination"
     * — a chain sells at Ray Gateway and loads the next leg there. A panel that showed only one of
     * the two would have the member undock having done half the job.
     */
    const at = whereInPlan([RUN, SECOND], {
      stationName: 'Ray Gateway',
      systemName: 'Diaguandri',
    });

    expect(at.sellHere.map((p) => p.commodity)).toEqual(['Gold']);
    expect(at.loadHere.map((p) => p.commodity)).toEqual(['Palladium']);
  });

  it('matches the way the game writes names, ignoring case and stray spaces', () => {
    const at = whereInPlan([RUN], {
      stationName: '  jameson memorial ',
      systemName: 'SHINRARTA DEZHRA',
    });
    expect(at.loadHere).toHaveLength(1);
  });

  it('says nothing applies when the member is somewhere else entirely', () => {
    const at = whereInPlan([RUN], { stationName: 'Deciat Gateway', systemName: 'Deciat' });
    expect(at.loadHere).toHaveLength(0);
    expect(at.sellHere).toHaveLength(0);
  });

  it('has nothing to say when we do not know where they are', () => {
    const at = whereInPlan([RUN], null);
    expect(at.loadHere).toHaveLength(0);
    expect(at.sellHere).toHaveLength(0);
  });
});

describe('the origin the plan was measured from', () => {
  it('travels with the plan, so the order can be a real shortest path', () => {
    /*
     * The journal names the station a member is docked at but never says where that is in space.
     * Without the planner's own origin the manifest can only GROUP the stops by system — which is
     * the fallback, not the feature the owner asked for.
     */
    const json = writeTradePlan([RUN], { x: 55.7, y: 17.6, z: 27.2 });
    expect(readPlanOrigin(json)).toEqual({ x: 55.7, y: 17.6, z: 27.2 });
  });

  it('is null when the plan carries none, rather than a guess at the middle of the galaxy', () => {
    expect(readPlanOrigin(writeTradePlan([RUN]))).toBeNull();
    expect(readPlanOrigin(null)).toBeNull();
    expect(readPlanOrigin('rubbish')).toBeNull();
  });
});
