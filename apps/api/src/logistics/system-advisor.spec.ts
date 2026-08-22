import { describe, expect, it } from 'vitest';
import { profileSystem, scoreRoles, type SurveyBody } from '@grims/shared';
import { readDraft, renderFacts } from './system-advisor.service.js';

/**
 * What the assistant is allowed to know about a system.
 *
 * ★ THIS IS THE SAFETY PROPERTY, NOT A FORMATTING TEST ★
 *
 * The owner asked for the model to choose layouts. It can — but only from facts computed here, and
 * the facts are the only thing standing between a fluent recommendation and a wrong one.
 *
 * A model handed "17 landable bodies, 4 ringed" will confidently call a system a mining hub. Handed
 * the same line PLUS "every body is over 100,000 Ls from the arrival point", it leads with the
 * distance. The difference is entirely in this string, so this string is what gets tested.
 *
 * Both warnings below were discovered by hand while planning real systems, and both would have
 * produced a plausible, professional, wrong plan if they had been left out.
 */

const body = (over: Partial<SurveyBody> & { kind: string }): SurveyBody => ({
  name: 'b',
  isLandable: false,
  hasRings: false,
  isTerraformCandidate: false,
  distanceLs: 1000,
  gravity: 0.5,
  temperatureK: 200,
  ...over,
});

const factsFor = (bodies: SurveyBody[], bloc: Parameters<typeof renderFacts>[3] = null): string => {
  const profile = profileSystem(bodies);
  return renderFacts('Test System', profile, scoreRoles(profile), bloc);
};

describe('the facts handed to the assistant', () => {
  it('★ MANDATORY: a remote system carries its warning into the prompt ★', () => {
    /*
     * Col 285 Sector GL-W c2-13: four ringed gas giants, seventeen landable moons, and every one of
     * them orbiting the second star 193,561 Ls out.
     *
     * Without this line the model sees an outstanding mining system and says so. The rings are real
     * — the supercruise is the reason nobody should build there first, and it is arithmetic the
     * model cannot do for itself because it never sees the body list.
     */
    const facts = factsFor([
      body({ kind: 'K Star', distanceLs: 0 }),
      body({ kind: 'Class I gas giant', hasRings: true, distanceLs: 193_599 }),
      ...Array.from({ length: 17 }, () => body({ kind: 'Icy body', isLandable: true, distanceLs: 193_600 })),
    ]);

    expect(facts).toContain('WARNING');
    expect(facts).toMatch(/100,000 Ls|supercruise/);
  });

  it('★ MANDATORY: a system with one landable body says settlements must be orbital ★', () => {
    /*
     * Col 285 Sector IG-W c2-14: a water world, two terraforming candidates, and exactly one body
     * anybody can land on.
     *
     * Agriculture and tourism SETTLEMENTS are surface builds. Without this line the obvious
     * recommendation is a surface resort on a world that cannot be landed on — which reads perfectly
     * and would waste a squadron's month.
     */
    const facts = factsFor([
      body({ kind: 'G Star', distanceLs: 0 }),
      body({ kind: 'Water world', distanceLs: 844 }),
      body({ kind: 'High metal content world', isTerraformCandidate: true, distanceLs: 357 }),
      body({ kind: 'Icy body', isLandable: true, distanceLs: 2358 }),
    ]);

    /*
     * ★ THREE PATHS CARRY THIS, AND MUTATION TESTING PROVED IT ★
     *
     * Removing the dedicated warning did not fail this test. Nor did removing the agriculture
     * objection as well. It took removing the tourism objection too — because the fact reaches the
     * model three separate ways, and any one of them is enough.
     *
     * That is defence in depth rather than a hole, and the assertion is deliberately about the
     * OUTCOME (the model is told) rather than about any one mechanism. A test pinned to the warning
     * line alone would fail the day somebody merged the three, having protected nothing extra.
     */
    expect(facts).toMatch(/only 1 landable body/i);
    expect(facts).toMatch(/orbit/i);
  });

  it('★ MANDATORY: the objections travel with the roles, not just the scores ★', () => {
    /*
     * A role list of "extraction (36), industrial (34)" invites the model to pick the top number.
     * The `against` lines are what stop that being the whole story, so they have to be in the
     * prompt rather than only in the API response the page renders.
     */
    const facts = factsFor([
      body({ kind: 'M Star', distanceLs: 0 }),
      body({ kind: 'Class I gas giant', hasRings: true, distanceLs: 150_000 }),
      ...Array.from({ length: 8 }, () => body({ kind: 'Icy body', isLandable: true, distanceLs: 150_001 })),
    ]);

    expect(facts).toContain('against:');
  });

  it('states the missing links when the system is in a bloc', () => {
    /*
     * The finding no single-system view can produce: the squadron refines ore in one system and
     * builds high tech in another and has nothing in between, so both ends trade outside it.
     */
    const facts = factsFor(
      [body({ kind: 'M Star', distanceLs: 0 }), body({ kind: 'Icy body', isLandable: true })],
      {
        name: 'Col 285 Core',
        decidedRole: null,
        gaps: [{ role: 'industrial', why: 'nothing between refinery and hightech' }],
      },
    );

    expect(facts).toContain('Col 285 Core');
    expect(facts).toContain('MISSING industrial');
  });

  it('says when a system already has a decided role, so advice does not re-litigate it', () => {
    const facts = factsFor([body({ kind: 'M Star' }), body({ kind: 'Icy body', isLandable: true })], {
      name: 'Col 285 Core',
      decidedRole: 'military',
      gaps: [],
    });

    expect(facts).toMatch(/already designated military/i);
  });

  it('never claims a resource the survey does not hold', () => {
    /*
     * The whole reason the counts are computed rather than described. A system with no water world
     * must not have the words in front of the model at all — a zero is a fact it can read, and the
     * absence of a mention is what it cannot invent around.
     */
    const facts = factsFor([
      body({ kind: 'M Star', distanceLs: 0 }),
      body({ kind: 'Icy body', isLandable: true, distanceLs: 500 }),
    ]);

    expect(facts).toContain('0 water worlds');
    expect(facts).toContain('0 terraforming candidates');
  });
});

describe('reading a layout the assistant proposed', () => {
  it('reads a clean answer', () => {
    const out = readDraft('[{"typeId":"plutus","bodyId":1,"why":"opens without locking the economy"}]');
    expect(out).toEqual([{ typeId: 'plutus', bodyId: 1, why: 'opens without locking the economy' }]);
  });

  it('★ MANDATORY: a fenced or chatty answer still reads ★', () => {
    /*
     * A model asked for JSON usually returns JSON, and "usually" is not a contract. A fence, a
     * sentence of explanation first, or both, all arrive eventually — and none of them should put a
     * stack trace on a planning page.
     */
    const fenced = 'Here is the layout:\n```json\n[{"typeId":"vesta","bodyId":4,"why":"the view"}]\n```';
    expect(readDraft(fenced)).toHaveLength(1);
  });

  it('★ MANDATORY: an unreadable answer is empty, not a throw ★', () => {
    /*
     * ★ THE TRAILING COMMA IS THE CASE THAT MATTERS, AND IT WAS MISSING ★
     *
     * The first version of this test listed junk that never reaches JSON.parse at all — no bracket,
     * an unclosed bracket, an object rather than an array — so removing the try/catch broke nothing
     * and the test looked like it covered the parse. Mutation testing found it.
     *
     * `[{"typeId":"plutus",}]` is the real shape: a model producing ALMOST valid JSON. It has both
     * brackets, it reaches the parse, and it throws.
     */
    for (const junk of [
      'not json at all',
      '',
      '[',
      '{"typeId":"plutus"}',
      '[1,2,3]',
      '[{"typeId":"plutus","bodyId":1,}]',
      '[{typeId: plutus}]',
      '[{"typeId":"plutus" "bodyId":1}]',
    ]) {
      expect(() => readDraft(junk), junk).not.toThrow();
      expect(readDraft(junk), junk).toEqual([]);
    }
  });

  it('★ MANDATORY: a body id that is not a number is refused, never coerced ★', () => {
    /*
     * `Number("body 4")` is NaN and `Number("")` is ZERO — and a zero body id would silently point
     * at whatever body happens to be numbered zero rather than being rejected as the nonsense it is.
     * Coercion here would turn a model's confusion into a plan step nobody could explain.
     */
    expect(readDraft('[{"typeId":"plutus","bodyId":"4","why":"x"}]')).toEqual([]);
    expect(readDraft('[{"typeId":"plutus","bodyId":"","why":"x"}]')).toEqual([]);
    expect(readDraft('[{"typeId":"plutus","bodyId":null,"why":"x"}]')).toEqual([]);
  });

  it('drops rows with no structure named, and keeps the rest', () => {
    // One bad row must not lose a whole layout — the good steps are still worth showing, and the
    // caller counts what was dropped and says so.
    const out = readDraft('[{"typeId":"","bodyId":1},{"typeId":"vesta","bodyId":2,"why":"ok"}]');
    expect(out).toHaveLength(1);
    expect(out[0]?.typeId).toBe('vesta');
  });
});
