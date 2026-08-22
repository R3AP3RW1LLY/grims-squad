import { describe, expect, it } from 'vitest';
import {
  blocGaps,
  profileSystem,
  REMOTE_LS,
  scoreRoles,
  type SurveyBody,
} from './system-role.js';

/**
 * What a system is good for, decided from its survey.
 *
 * ★ THE CASES ARE REAL SYSTEMS, NOT INVENTED ONES ★
 *
 * Every fixture below is the actual EDSM survey of a Col 285 system the squadron is building in or
 * next to. That matters more than usual here: this module exists to stop a recommendation being
 * made about a system nobody looked at, and a spec built on imaginary bodies would be the same
 * mistake in a test file.
 *
 * Two of these cases changed a hand-written plan when they were discovered, and both are arithmetic
 * rather than judgement — which is exactly why they belong in code that runs on every system rather
 * than in an officer's memory.
 */

const body = (over: Partial<SurveyBody> & { kind: string }): SurveyBody => ({
  name: 'body',
  isLandable: false,
  hasRings: false,
  isTerraformCandidate: false,
  distanceLs: 1000,
  gravity: 0.5,
  temperatureK: 200,
  ...over,
});

/**
 * Col 285 Sector GL-W c2-13, as surveyed.
 *
 * Four ringed bodies and seventeen landable moons — and every one of them orbits the SECOND star at
 * 193,561 Ls, because the K-class primary has nothing around it at all.
 */
const REMOTE_SYSTEM: SurveyBody[] = [
  body({ kind: 'K (Yellow-Orange) Star', distanceLs: 0 }),
  body({ kind: 'M (Red dwarf) Star', distanceLs: 193_561 }),
  body({ kind: 'Gas giant with ammonia-based life', hasRings: true, distanceLs: 193_599 }),
  body({ kind: 'Gas giant with ammonia-based life', hasRings: true, distanceLs: 194_114 }),
  body({ kind: 'Class I gas giant', hasRings: true, distanceLs: 194_102 }),
  body({ kind: 'Class I gas giant', hasRings: true, distanceLs: 194_336 }),
  ...Array.from({ length: 17 }, (_, i) =>
    body({ kind: 'Icy body', isLandable: true, distanceLs: 193_600 + i }),
  ),
];

/**
 * Col 285 Sector IG-W c2-14, as surveyed.
 *
 * A water world, two terraforming candidates, a G-class star — and exactly ONE landable body.
 */
const WATER_SYSTEM: SurveyBody[] = [
  body({ kind: 'G (White-Yellow) Star', distanceLs: 0 }),
  body({ kind: 'High metal content world', distanceLs: 234 }),
  body({ kind: 'High metal content world', isTerraformCandidate: true, distanceLs: 357 }),
  body({ kind: 'High metal content world', isTerraformCandidate: true, distanceLs: 638 }),
  body({ kind: 'Water world', distanceLs: 844 }),
  body({ kind: 'High metal content world', distanceLs: 1171 }),
  body({ kind: 'Rocky Ice world', distanceLs: 2354 }),
  body({ kind: 'Icy body', isLandable: true, distanceLs: 2358 }),
  body({ kind: 'Icy body', distanceLs: 4033 }),
  body({ kind: 'Icy body', distanceLs: 5642 }),
];

/** Col 285 Sector IG-W c2-15: eleven bodies, two landable, no rings, nothing to dig. */
const THIN_SYSTEM: SurveyBody[] = [
  body({ kind: 'M (Red dwarf) Star', distanceLs: 0 }),
  body({ kind: 'High metal content world', distanceLs: 364 }),
  ...Array.from({ length: 7 }, (_, i) => body({ kind: 'Icy body', distanceLs: 600 + i * 400 })),
  body({ kind: 'Icy body', isLandable: true, distanceLs: 817 }),
  body({ kind: 'Icy body', isLandable: true, distanceLs: 3183 }),
];

describe('reading a system before recommending anything about it', () => {
  it('counts only bodies, never the stars', () => {
    // A two-star system would otherwise report a body count nobody recognises, and "landable" would
    // be measured against a denominator that includes suns.
    const profile = profileSystem(WATER_SYSTEM);
    expect(profile.bodyCount).toBe(WATER_SYSTEM.length - 1);
  });

  it('★ MANDATORY: a system whose NEAREST body is 193,000 Ls out is remote ★', () => {
    /*
     * Col 285 Sector GL-W c2-13. It looks like the best extraction system in the bloc — four ringed
     * bodies, seventeen landable moons — and every one of them orbits the second star.
     *
     * Nothing about the body LIST says this. It is arithmetic on the distances, and it is the fact
     * that decides whether the system is worth building at all: ~194,000 Ls of supercruise on every
     * leg against 6,198 Ls for the far end of its neighbour.
     */
    const profile = profileSystem(REMOTE_SYSTEM);

    expect(profile.remote).toBe(true);
    expect(profile.ringed, 'the rings really are there').toBe(4);
    expect(profile.landable).toBe(17);
  });

  it('★ MANDATORY: remoteness is judged on the NEAREST body, not the farthest ★', () => {
    /*
     * A system with one close body and a long tail is perfectly workable — you build at the near
     * end. Judging on the farthest would condemn an ordinary system for having an outer moon, and
     * would be the kind of wrong that quietly removes good systems from consideration.
     */
    const tailed = [
      body({ kind: 'M Star', distanceLs: 0 }),
      body({ kind: 'High metal content world', isLandable: true, distanceLs: 120 }),
      body({ kind: 'Icy body', distanceLs: 400_000 }),
    ];

    const profile = profileSystem(tailed);
    expect(profile.farthestLs).toBe(400_000);
    expect(profile.remote, 'a near body makes the system workable').toBe(false);
  });

  it('counts what a surface build can actually go on', () => {
    /*
     * Col 285 Sector IG-W c2-14 has a water world, two terraforming candidates — and one landable
     * body. A water world is not landable and neither is a gas giant, so a system can be rich and
     * still have almost no room for settlements.
     */
    const profile = profileSystem(WATER_SYSTEM);
    expect(profile.waterWorlds).toBe(1);
    expect(profile.terraformCandidates).toBe(2);
    expect(profile.surfaceCapacity, 'one landable body in the whole system').toBe(1);
  });
});

describe('what a system should be steered toward', () => {
  it('★ MANDATORY: a remote system still says so, however good its rings are ★', () => {
    /*
     * The dangerous shape: extraction scores highest BECAUSE the rings are real, and a
     * recommendation that stopped there would send a squadron to a system where every run is a
     * 194,000 Ls supercruise. The objection is not a footnote — it is the more important half.
     */
    const fits = scoreRoles(profileSystem(REMOTE_SYSTEM));
    const extraction = fits.find((f) => f.role === 'extraction');

    expect(extraction, 'the rings still earn the score').toBeDefined();
    expect(extraction?.against.join(' '), 'and the distance is stated in the same breath').toMatch(
      /Ls|supercruise/i,
    );
  });

  it('★ MANDATORY: agriculture on a one-landable system warns that it must be orbital ★', () => {
    /*
     * The mistake this prevents, written out by hand before it was written in code: a water world
     * and two terraforming candidates make agriculture the obvious call, and agricultural
     * SETTLEMENTS are surface builds. A plan that missed this would tell members to build on a
     * world they cannot land on.
     */
    const fits = scoreRoles(profileSystem(WATER_SYSTEM));
    const agri = fits.find((f) => f.role === 'agriculture');

    expect(agri?.score ?? 0).toBeGreaterThan(0);
    expect(agri?.against.join(' ')).toMatch(/orbital|Space Farm/i);
  });

  it('★ MANDATORY: rings outrank a pile of ordinary moons ★', () => {
    /*
     * Caught by running the scorer against the real survey of GL-W c2-13 and finding it disagreed
     * with the analysis a person had done of the same system.
     *
     * Four ringed gas giants and seventeen landable icy moons. Weighted at 3 per ring the moons won
     * and it read as industrial — but icy moons are everywhere and ringed gas giants are not. Rings
     * are what this system has that its neighbours do not, which is the whole basis of giving a
     * system a role.
     */
    const fits = scoreRoles(profileSystem(REMOTE_SYSTEM));
    expect(fits[0]?.role).toBe('extraction');
  });

  it('ranks the water world system toward agriculture and tourism', () => {
    const fits = scoreRoles(profileSystem(WATER_SYSTEM));
    const top = fits.slice(0, 2).map((f) => f.role);

    expect(top).toContain('agriculture');
    expect(top).toContain('tourism');
  });

  it('★ MANDATORY: a thin system is offered as military rather than as nothing ★', () => {
    /*
     * Eleven bodies, two landable, no rings. Every other economy scores it poorly and correctly —
     * but "this system is no good" is not a useful answer when the squadron already owns it.
     *
     * Security is the one job a thin system does as well as a rich one, and it returns something to
     * every other system in the bloc. Scored INVERSELY on purpose.
     */
    const fits = scoreRoles(profileSystem(THIN_SYSTEM));
    expect(fits[0]?.role).toBe('military');
  });

  it('never scores a role without saying why', () => {
    // A score with no reason is a recommendation somebody has to take on trust, which is the thing
    // this module exists to avoid.
    for (const system of [REMOTE_SYSTEM, WATER_SYSTEM, THIN_SYSTEM]) {
      for (const fit of scoreRoles(profileSystem(system))) {
        expect(fit.reasons.length, `${fit.role} scored ${fit.score} with no reason given`).toBeGreaterThan(0);
      }
    }
  });

  it('returns them best first', () => {
    const fits = scoreRoles(profileSystem(REMOTE_SYSTEM));
    const scores = fits.map((f) => f.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('is honest about the threshold it uses', () => {
    // 100,000 Ls. Named as a constant so a reader can disagree with the number rather than having
    // to find it.
    expect(REMOTE_LS).toBe(100_000);
  });
});

describe('what a group of systems cannot make for itself', () => {
  it('★ MANDATORY: names a missing middle when both its neighbours exist ★', () => {
    /*
     * The finding that made the four build books worth reading, and the one no single-system view
     * can produce: c2-12 refines ore and c2-16 builds high tech, and NOTHING between them turned
     * refined metal into components — so both ends traded outside the squadron for the middle step.
     */
    const gaps = blocGaps(['extraction', 'refinery', 'hightech']);
    const industrial = gaps.find((g) => g.role === 'industrial');

    expect(industrial, 'the missing link is named').toBeDefined();
    expect(industrial?.why, 'and why it is the expensive kind of missing').toMatch(
      /sells outside|buys back/i,
    );
  });

  it('says nothing about a chain that is complete', () => {
    const gaps = blocGaps(['extraction', 'refinery', 'industrial', 'hightech', 'agriculture', 'military']);
    expect(gaps).toEqual([]);
  });

  it('counts food and security as gaps, because a bloc without them buys both', () => {
    const gaps = blocGaps(['extraction', 'refinery', 'industrial', 'hightech']).map((g) => g.role);
    expect(gaps).toContain('agriculture');
    expect(gaps).toContain('military');
  });
});
