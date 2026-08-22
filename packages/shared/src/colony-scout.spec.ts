import { describe, expect, it } from 'vitest';
import {
  CLAIM_RANGE_LY,
  bestPermitSource,
  scoreCandidate,
  explainCandidate,
  rankCandidates,
  type PermitSource,
  type ScoutCandidate, sweepNotice } from './colony-scout.js';

/**
 * Choosing where to colonise next.
 *
 * ★ SQUADRON OWNER, 2026-08-07 ★
 *
 * "can we build a tool ... that literally does what we just did here for this planning and research
 * and system selection?"
 *
 * ★ THE PERMIT SOURCE IS THE PART EVERYBODY FORGETS ★
 *
 * A system can be perfect and unreachable. The claim has to be bought at a station within range, and
 * WHOSE station it is decides which power you extend — which is the difference between growing the
 * Federal faction that runs your home and quietly handing systems to the Alliance.
 */

const OFFICE: PermitSource = {
  system: 'Col 285 Sector EL-X d1-28',
  x: 0,
  y: 0,
  z: 0,
  allegiance: 'Federation',
  controllingFaction: 'Federal Fleet Marine Force',
  stationCount: 61,
  hasOrbital: true,
};

const ALLIANCE: PermitSource = {
  system: 'Col 285 Sector DA-Y c1-5',
  x: 3,
  y: 0,
  z: 0,
  allegiance: 'Alliance',
  controllingFaction: 'Some Alliance Lot',
  stationCount: 1,
  hasOrbital: true,
};

const NO_STATIONS: PermitSource = {
  system: 'Empty Place',
  x: 1,
  y: 0,
  z: 0,
  allegiance: 'Federation',
  controllingFaction: 'Nobody',
  stationCount: 0,
  hasOrbital: false,
};

describe('finding where the permit is bought', () => {
  it('picks the nearest source that actually has a station', () => {
    /*
     * `NO_STATIONS` is closer and must lose. A populated system with no station sells no
     * colonisation ship, so proximity alone is the wrong answer.
     */
    const at = { x: 2, y: 0, z: 0 };
    const found = bestPermitSource(at, [NO_STATIONS, ALLIANCE, OFFICE]);
    expect(found?.system).toBe('Col 285 Sector DA-Y c1-5');
  });

  it('prefers a source matching the allegiance you asked for, even if further', () => {
    /*
     * ★ THE WHOLE POINT OF THE OWNER'S CONSTRAINT ★
     *
     * "we want the federation that runs my system in other systems too". A closer Alliance station
     * would work mechanically and defeat the purpose entirely.
     */
    const at = { x: 2, y: 0, z: 0 };
    const found = bestPermitSource(at, [ALLIANCE, OFFICE], { prefer: 'Federation' });
    expect(found?.system).toBe('Col 285 Sector EL-X d1-28');
    expect(found?.allegiance).toBe('Federation');
  });

  it('falls back to any reachable source when the preferred allegiance has none in range', () => {
    // Better a claim through the wrong power than no claim at all — but the caller can see which.
    const at = { x: 2, y: 0, z: 0 };
    const found = bestPermitSource(at, [ALLIANCE], { prefer: 'Federation' });
    expect(found?.system).toBe('Col 285 Sector DA-Y c1-5');
    expect(found?.allegiance).toBe('Alliance');
  });

  it('returns null when nothing is inside claim range', () => {
    const far = { x: 500, y: 0, z: 0 };
    expect(bestPermitSource(far, [OFFICE, ALLIANCE])).toBeNull();
  });

  it('uses the game’s claim range unless told otherwise', () => {
    expect(CLAIM_RANGE_LY).toBe(15);
    const at = { x: 14, y: 0, z: 0 };
    expect(bestPermitSource(at, [OFFICE])?.system).toBe('Col 285 Sector EL-X d1-28');

    const beyond = { x: 16, y: 0, z: 0 };
    expect(bestPermitSource(beyond, [OFFICE])).toBeNull();
  });
});

const candidate = (over: Partial<ScoutCandidate> = {}): ScoutCandidate => ({
  system: 'Test',
  x: 1,
  y: 0,
  z: 0,
  bodyCount: 10,
  landableCount: 5,
  nearestLandableLs: 500,
  hotspots: {},
  pristine: true,
  surveyed: true,
  permit: OFFICE,
  permitLy: 5,
  ...over,
});

describe('scoring a candidate', () => {
  it('MANDATORY: a system whose bodies are all absurdly far scores below a closer, smaller one', () => {
    /*
     * ★ THE TRAP THAT NEARLY GOT RECOMMENDED ★
     *
     * Col 285 Sector GL-W c2-13 has 26 bodies and 17 landable — the biggest numbers in its pocket —
     * and every one of those landables sits at 193,600 Ls. It looks like the best system on any
     * spreadsheet that does not read arrival distance.
     */
    const trap = candidate({ system: 'far', bodyCount: 26, landableCount: 17, nearestLandableLs: 193_599 });
    const modest = candidate({ system: 'near', bodyCount: 10, landableCount: 6, nearestLandableLs: 7 });

    expect(scoreCandidate(modest)).toBeGreaterThan(scoreCandidate(trap));
  });

  it('MANDATORY: many far bodies never beat few close ones — the real numbers', () => {
    /*
     * ★ CAUGHT BY RUNNING IT, NOT BY TESTING IT ★
     *
     * The first scorer subtracted a flat penalty for distance. Against the real candidate list it
     * ranked GL-W c2-13 SECOND out of eight — seventeen landable bodies, every one at 193,599 Ls —
     * because seventeen bodies at six points each swamped a sixty-point penalty.
     *
     * These are the measured figures for both systems. Seventeen bodies you will never visit twice
     * are not seventeen bodies, and the gap must be decisive rather than marginal.
     */
    const trap = candidate({
      system: 'Col 285 Sector GL-W c2-13',
      bodyCount: 26,
      landableCount: 17,
      nearestLandableLs: 193_599,
      permitLy: 15.9,
      hotspots: { Tritium: 3, VoidOpal: 5, Grandidierite: 5 },
    });
    const real = candidate({
      system: 'Col 285 Sector TX-Q b6-1',
      bodyCount: 10,
      landableCount: 6,
      nearestLandableLs: 7,
      permitLy: 11.4,
    });

    expect(scoreCandidate(real)).toBeGreaterThan(scoreCandidate(trap) + 25);
  });

  it('rewards landable bodies over a bare body count', () => {
    // Bodies you cannot land on cannot host settlements, so they build far less.
    const many = candidate({ bodyCount: 30, landableCount: 1 });
    const useful = candidate({ bodyCount: 12, landableCount: 9 });
    expect(scoreCandidate(useful)).toBeGreaterThan(scoreCandidate(many));
  });

  it('rewards Pristine reserves', () => {
    expect(scoreCandidate(candidate({ pristine: true }))).toBeGreaterThan(
      scoreCandidate(candidate({ pristine: false })),
    );
  });

  it('penalises a permit source that is barely in range', () => {
    const easy = candidate({ permitLy: 3 });
    const tight = candidate({ permitLy: 14.8 });
    expect(scoreCandidate(easy)).toBeGreaterThan(scoreCandidate(tight));
  });

  it('MANDATORY: scores a candidate with no reachable permit at the very bottom', () => {
    // Unclaimable is not "slightly worse" — it is not a candidate at all.
    const unreachable = candidate({ permit: null, permitLy: null, bodyCount: 40, landableCount: 30 });
    expect(scoreCandidate(unreachable)).toBeLessThan(0);
  });

  it('ranks a list, best first, and never crashes on an empty one', () => {
    const ranked = rankCandidates([
      candidate({ system: 'poor', landableCount: 1, nearestLandableLs: 90_000 }),
      candidate({ system: 'good', landableCount: 8, nearestLandableLs: 40 }),
    ]);
    expect(ranked[0]?.system).toBe('good');
    expect(rankCandidates([])).toEqual([]);
  });

  it('counts hotspots but does not let them outweigh being unbuildable', () => {
    const richButFar = candidate({
      system: 'rich',
      hotspots: { Platinum: 8, Tritium: 10 },
      landableCount: 2,
      nearestLandableLs: 150_000,
    });
    const plainButClose = candidate({ system: 'plain', hotspots: {}, landableCount: 8, nearestLandableLs: 100 });
    expect(scoreCandidate(plainButClose)).toBeGreaterThan(scoreCandidate(richButFar));
  });
});

describe('candidates nobody has surveyed yet', () => {
  it('MANDATORY: an unsurveyed system is not scored as though it had no landable bodies', () => {
    /*
     * ★ FOUND BY RUNNING THE REAL SEARCH ★
     *
     * The candidate search returns systems before anything is known about their bodies. Treating
     * that as "no landables" applied the forty-point nothing-to-land-on penalty to every fresh
     * candidate and made the entire live result set negative — which reads as "all of these are
     * bad" when the truth is "none of these have been looked at".
     */
    const fresh = candidate({ surveyed: false, landableCount: 0, nearestLandableLs: null, bodyCount: 20 });
    const known = candidate({ surveyed: true, landableCount: 0, nearestLandableLs: null, bodyCount: 20 });

    expect(scoreCandidate(fresh)).toBeGreaterThan(scoreCandidate(known));
    expect(scoreCandidate(fresh)).toBeGreaterThan(0);
  });

  it('lets a survey move a candidate in either direction', () => {
    const fresh = candidate({ surveyed: false, bodyCount: 10, landableCount: 0, nearestLandableLs: null });
    const good = candidate({ surveyed: true, bodyCount: 10, landableCount: 6, nearestLandableLs: 7 });
    const bad = candidate({ surveyed: true, bodyCount: 10, landableCount: 6, nearestLandableLs: 190_000 });

    expect(scoreCandidate(good)).toBeGreaterThan(scoreCandidate(fresh));
    expect(scoreCandidate(bad)).toBeLessThan(scoreCandidate(fresh));
  });
});

/**
 * ★ WHY THIS SYSTEM — SQUADRON OWNER, 2026-08-10 ★
 *
 * Picked from the colonisation suggestions, listed there as an AI feature. It is not one, and
 * should not be: this scorer is built from named terms that already know exactly why they fired. A
 * model asked to explain them could only paraphrase — ten seconds and a tunnel to a machine in
 * somebody's house, to say something the arithmetic already knows for free and cannot get wrong.
 *
 * So the score explains itself, in the same pass that computes it.
 */
describe('a candidate score that shows its working', () => {
  const base = {
    system: 'Col 285 Sector GL-W c2-12',
    x: 0,
    y: 0,
    z: 0,
    bodyCount: 22,
    landableCount: 8,
    nearestLandableLs: 640,
    hotspots: {},
    surveyed: true,
    pristine: false,
    permit: 'Somewhere',
    permitLy: 6,
    permitAllegiance: null,
    permitStations: 3,
  } as unknown as Parameters<typeof explainCandidate>[0];

  it('★ MANDATORY: the reasons add up to the score ★', () => {
    /*
     * The property that makes an explanation trustworthy. If the reasons can drift from the number
     * they explain, the panel is lying with arithmetic — and nobody would be able to tell, because
     * both halves look authoritative.
     */
    for (const c of [
      base,
      { ...base, surveyed: false },
      { ...base, nearestLandableLs: null },
      { ...base, pristine: true, hotspots: { Painite: 3, Platinum: 2 } },
      { ...base, permitLy: 19 },
    ]) {
      const out = explainCandidate(c);
      const summed = out.reasons.reduce((n, r) => n + r.points, 0);
      // Rounded to a tenth per reason, so the sum is compared at that tolerance rather than exactly.
      expect(Math.abs(summed - out.score), `${JSON.stringify(c.system)} ${summed} vs ${out.score}`)
        .toBeLessThan(reasonsTolerance(out.reasons.length));
    }
  });

  it('★ MANDATORY: it still returns exactly the score it always did ★', () => {
    // The refactor split the arithmetic out; if it changed a single term every ranking would
    // silently reorder, which is the one thing nobody would notice from a green suite.
    for (const c of [base, { ...base, surveyed: false }, { ...base, permitLy: 19 }]) {
      expect(scoreCandidate(c)).toBe(explainCandidate(c).score);
    }
  });

  it('★ MANDATORY: an unclaimable system says so, and says nothing else ★', () => {
    /*
     * -1000 is not a score somebody should have to interpret. It means one thing, and listing body
     * counts beside it would suggest the system is merely poor rather than impossible.
     */
    const out = explainCandidate({ ...base, permit: null, permitLy: null } as typeof base);
    expect(out.score).toBe(-1000);
    expect(out.reasons).toHaveLength(1);
    expect(out.reasons[0]?.text).toMatch(/cannot be claimed/i);
  });

  it('MANDATORY: the heaviest term is named first', () => {
    // A list that leads with a two-point bonus buries the forty-point penalty that decided it.
    const out = explainCandidate({ ...base, nearestLandableLs: null, pristine: true });
    expect(out.reasons[0]?.text).toMatch(/nothing landable/i);
  });

  it('an unsurveyed system is described as unsurveyed, not as empty', () => {
    // "Unknown is not zero" — the same distinction the scorer itself is built on.
    const out = explainCandidate({ ...base, surveyed: false });
    expect(out.reasons.map((r) => r.text).join(' ')).toMatch(/not yet surveyed/i);
  });
});

/** Each reason is rounded to a tenth, so n reasons can drift by at most n×0.05 from the raw sum. */
function reasonsTolerance(count: number): number {
  return Math.max(0.11, count * 0.06);
}

/**
 * ★ THE SENTENCE THAT SEPARATES "NOTHING THERE" FROM "WE COULD NOT LOOK" ★
 *
 * The owner reported the scout "no longer finding anything". It was finding things — the sweep was
 * timing out and the empty result rendered as "Nothing claimable in range", which is what an empty
 * region renders as. These guard the one piece of text that tells those apart.
 */
describe('telling a member their search did not finish', () => {
  it('★ MANDATORY: a finished sweep says nothing at all ★', () => {
    /*
     * If a complete sweep produced a notice, every quiet corner of the galaxy would carry a warning
     * and members would learn to read past the one that matters.
     */
    expect(sweepNotice(null, 0)).toBeNull();
    expect(sweepNotice(null, 48)).toBeNull();
  });

  it('★ MANDATORY: an empty failed sweep says we could not look ★', () => {
    const msg = sweepNotice('timeout', 0);

    expect(msg).not.toBeNull();
    expect(msg, 'the whole point: this must not read as an empty region').toMatch(
      /could not look|did not answer/i,
    );
  });

  it('says how many it did find when it found some', () => {
    expect(sweepNotice('network', 48)).toContain('48');
  });

  it('★ MANDATORY: a page cap asks for a NARROWER search, not another attempt ★', () => {
    /*
     * "Try again" and "narrow the range" are opposite instructions. Repeating an identical search
     * that hit a page cap returns an identical truncated list, so telling somebody to retry would
     * send them round a loop that cannot end.
     */
    const capped = sweepNotice('page-cap', 1000);
    expect(capped).toMatch(/narrow/i);
    expect(capped, 'retrying is exactly the wrong advice here').not.toMatch(/try again in a moment/i);

    const stalled = sweepNotice('timeout', 1000);
    expect(stalled).toMatch(/try again/i);
    expect(stalled).not.toMatch(/narrow/i);
  });
});
