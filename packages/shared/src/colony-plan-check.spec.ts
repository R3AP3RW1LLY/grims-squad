import { describe, expect, it } from 'vitest';
import { checkColonyPlan, type BuildType, type PlanBodyRef, type PlannedBuild } from './colony-plan-check.js';

/**
 * The colonisation plan validator.
 *
 * ★ SQUADRON OWNER, 2026-08-07 ★
 *
 * "can we build a tool into our web and companion app that literally does what we just did here for
 * this planning and research and system selection?"
 *
 * ★ EVERY RULE HERE IS A MISTAKE THAT WAS ACTUALLY MADE ★
 *
 * Planning a 380,000-tonne colony by hand produced, in one afternoon: a first build that would have
 * permanently locked the system's economy, a structure whose prerequisite nothing supplied, a
 * surface settlement more than once placed on a body that cannot be landed on, and a cluster plan
 * needing thirteen surface slots where eleven exist.
 *
 * None of those are visible until you are in the game with the tonnage already hauled. Every one is
 * decidable from data we already hold, which is the entire argument for this file.
 */

const TYPES: BuildType[] = [
  // Openers. `plutus` leaves the economy free; `vulcan` locks it to industrial for ever.
  { id: 'plutus', tier: 1, location: 'orbital', buildClass: 'outpost', tonnes: 18473, needsTier: 0, needsPoints: 0, givesTier: 2, givesPoints: 1, requires: null, satisfies: [], influence: 'colony', fixed: null },
  { id: 'vulcan', tier: 1, location: 'orbital', buildClass: 'outpost', tonnes: 18473, needsTier: 0, needsPoints: 0, givesTier: 2, givesPoints: 1, requires: null, satisfies: [], influence: 'industrial', fixed: 'industrial' },

  { id: 'ourea', tier: 1, location: 'surface', buildClass: 'settlement', tonnes: 2845, needsTier: 0, needsPoints: 0, givesTier: 2, givesPoints: 1, requires: null, satisfies: ['settlementExtraction'], influence: 'extraction', fixed: null },
  { id: 'bellona', tier: 1, location: 'surface', buildClass: 'settlement', tonnes: 5684, needsTier: 0, needsPoints: 0, givesTier: 2, givesPoints: 1, requires: null, satisfies: ['settlementMilitary'], influence: 'military', fixed: null },

  { id: 'silenus', tier: 2, location: 'surface', buildClass: 'hub', tonnes: 9919, needsTier: 2, needsPoints: 1, givesTier: 3, givesPoints: 1, requires: null, satisfies: [], influence: 'refinery', fixed: null },
  { id: 'tartarus', tier: 2, location: 'surface', buildClass: 'hub', tonnes: 9919, needsTier: 2, needsPoints: 1, givesTier: 3, givesPoints: 1, requires: 'settlementExtraction', satisfies: [], influence: 'extraction', fixed: null },
  { id: 'astraeus', tier: 2, location: 'orbital', buildClass: 'installation', tonnes: 10083, needsTier: 2, needsPoints: 1, givesTier: 3, givesPoints: 1, requires: 'settlementBio', satisfies: [], influence: 'hightech', fixed: null },

  { id: 'dodec', tier: 3, location: 'orbital', buildClass: 'starport', tonnes: 236304, needsTier: 3, needsPoints: 6, givesTier: 0, givesPoints: 0, requires: null, satisfies: [], influence: 'colony', fixed: null },
];

const BODIES: PlanBodyRef[] = [
  { bodyId: 9, name: 'A 1', landable: false, distanceLs: 864 },
  { bodyId: 17, name: 'A 1 e', landable: true, distanceLs: 862 },
  { bodyId: 18, name: 'A 1 f', landable: true, distanceLs: 859 },
  { bodyId: 56, name: 'B 8', landable: false, distanceLs: 151334 },
];

const build = (typeId: string, bodyId: number): PlannedBuild => ({ typeId, bodyId });

describe('the plan validator', () => {
  it('passes a plan that is actually legal', () => {
    const out = checkColonyPlan(
      [build('plutus', 9), build('ourea', 18), build('silenus', 17)],
      TYPES,
      BODIES,
    );
    expect(out.errors, JSON.stringify(out.errors)).toEqual([]);
    expect(out.ok).toBe(true);
  });

  it('MANDATORY: refuses an opener that permanently locks the economy', () => {
    /*
     * ★ THE COSTLIEST MISTAKE OF THE AFTERNOON ★
     *
     * `vulcan` carries `fixed: 'industrial'`, which no later build can undo. Opening with it makes
     * a refinery economy unreachable for the life of the system, in a region that pays seven times
     * less for the industrial line. It was recommended out loud before the catalogue was checked.
     */
    const out = checkColonyPlan([build('vulcan', 9)], TYPES, BODIES);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.code === 'economy-locked')).toBe(true);
    expect(out.errors[0]?.message).toMatch(/vulcan/);
  });

  it('allows a locking build later, once the economy is already set', () => {
    // The lock only matters for the FIRST build. Afterwards it is just another influence vote.
    const out = checkColonyPlan([build('plutus', 9), build('vulcan', 9)], TYPES, BODIES);
    expect(out.errors.some((e) => e.code === 'economy-locked')).toBe(false);
  });

  it('MANDATORY: refuses a surface build on a body that cannot be landed on', () => {
    // A 1 is a gas giant. You can orbit it; you cannot put a settlement on it.
    const out = checkColonyPlan([build('plutus', 9), build('ourea', 9)], TYPES, BODIES);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.code === 'not-landable')).toBe(true);
  });

  it('MANDATORY: refuses a build whose prerequisite nothing supplies', () => {
    /*
     * `astraeus` needs `settlementBio`. Nothing here provides it, so in game the build is simply
     * greyed out — the same way the owner's dodec was, with no explanation given.
     */
    const out = checkColonyPlan([build('plutus', 9), build('astraeus', 9)], TYPES, BODIES);
    expect(out.ok).toBe(false);
    const err = out.errors.find((e) => e.code === 'missing-prerequisite');
    expect(err?.message).toMatch(/settlementBio/);
  });

  it('accepts a prerequisite supplied EARLIER in the same plan', () => {
    const out = checkColonyPlan(
      [build('plutus', 9), build('ourea', 18), build('tartarus', 17)],
      TYPES,
      BODIES,
    );
    expect(out.errors.some((e) => e.code === 'missing-prerequisite')).toBe(false);
  });

  it('MANDATORY: refuses a prerequisite supplied LATER — order is the whole point', () => {
    // Same three builds, wrong order. A plan is a sequence, not a shopping list.
    const out = checkColonyPlan(
      [build('plutus', 9), build('tartarus', 17), build('ourea', 18)],
      TYPES,
      BODIES,
    );
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.code === 'missing-prerequisite')).toBe(true);
  });

  it('MANDATORY: refuses a tier-3 starport that has not earned its points', () => {
    const out = checkColonyPlan([build('plutus', 9), build('dodec', 9)], TYPES, BODIES);
    expect(out.ok).toBe(false);
    const err = out.errors.find((e) => e.code === 'not-enough-points');
    expect(err?.message).toMatch(/6/);
  });

  it('refuses spending tier-2 points that were never earned', () => {
    // A T2 build as the very first thing in a system: no T1 has run, so there is nothing to spend.
    const out = checkColonyPlan([build('silenus', 17)], TYPES, BODIES);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.code === 'not-enough-points')).toBe(true);
  });

  it('reports the running point balance so a planner can show it', () => {
    const out = checkColonyPlan(
      [build('plutus', 9), build('ourea', 18), build('silenus', 17)],
      TYPES,
      BODIES,
    );
    expect(out.steps.map((s) => s.tier2After)).toEqual([1, 2, 1]);
    expect(out.steps.map((s) => s.tier3After)).toEqual([0, 0, 1]);
  });

  it('counts the economy so the leading influence is visible before anything is hauled', () => {
    const out = checkColonyPlan(
      [build('plutus', 9), build('ourea', 18), build('silenus', 17), build('silenus', 17)],
      TYPES,
      BODIES,
    );
    expect(out.influence['refinery']).toBe(2);
    expect(out.leadingEconomy).toBe('refinery');
  });

  it('MANDATORY: refuses more surface builds than a body can hold', () => {
    /*
     * The A-cluster failure: a plan needing thirteen surface slots where eleven moons exist. One
     * body takes one surface build, so two settlements on one moon is the same error in miniature.
     */
    const out = checkColonyPlan(
      [build('plutus', 9), build('ourea', 18), build('bellona', 18)],
      TYPES,
      BODIES,
    );
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.code === 'slot-taken')).toBe(true);
  });

  it('names an unknown body or build type rather than silently ignoring it', () => {
    const a = checkColonyPlan([build('plutus', 999)], TYPES, BODIES);
    expect(a.errors.some((e) => e.code === 'unknown-body')).toBe(true);

    const b = checkColonyPlan([build('nonesuch', 9)], TYPES, BODIES);
    expect(b.errors.some((e) => e.code === 'unknown-type')).toBe(true);
  });

  it('warns about a build parked absurdly far out without refusing it', () => {
    /*
     * 151,334 Ls is legal and sometimes deliberate — the owner's own dodec is there. A validator
     * that refused it would be wrong; one that says nothing lets somebody commit to a fifteen-minute
     * supercruise per visit without noticing.
     */
    const out = checkColonyPlan([build('plutus', 56)], TYPES, BODIES);
    expect(out.ok).toBe(true);
    expect(out.warnings.some((w) => w.code === 'very-far')).toBe(true);
  });

  it('totals the tonnage and the Type-9 loads', () => {
    const out = checkColonyPlan([build('plutus', 9), build('ourea', 18)], TYPES, BODIES);
    expect(out.totalTonnes).toBe(18473 + 2845);
    expect(out.type9Loads).toBe(Math.ceil((18473 + 2845) / 702));
  });
});
