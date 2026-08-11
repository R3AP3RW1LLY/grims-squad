import { describe, expect, it } from 'vitest';
import { REVIEW_PROMPT, renderPlanFacts, reviewableReason, type PlanFacts } from './colony-plan-review.js';

/**
 * What the model is allowed to know about a plan.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "AI plan review" — read my plan and tell me what is wrong with it.
 *
 * ★ WHY THE FACTS ARE TESTED AND THE PROSE IS NOT ★
 *
 * The sentences come from a language model and cannot be asserted on. What CAN be held still is
 * what it was told: a review is only as honest as its facts, and a fact assembled inside a service
 * that also makes a network call is a fact nobody can check.
 *
 * Every number here is computed by `simulatePlan` and `suggestBuildOrder`. The model explains and
 * prioritises; it never works anything out. That ordering is the whole design — a confidently wrong
 * sentence about a build order costs a squadron a fortnight, and they will not come back to check
 * whether the tool was right.
 */

const NONE = {
  population: 0,
  maxPopulation: 0,
  security: 0,
  technology: 0,
  wealth: 0,
  standardOfLiving: 0,
  development: 0,
};

function facts(over: Partial<PlanFacts> = {}): PlanFacts {
  return {
    systemName: 'Col 285 Sector GL-W c2-12',
    siteCount: 81,
    totalTonnes: 1_065_059,
    bodyCount: 14,
    bodiesWithoutSlots: 12,
    simulation: {
      steps: [],
      tier2: 0,
      tier3: 0,
      surchargedPorts: 0,
      problems: [],
      economy: { counts: {}, primary: null, secondary: null, locked: false, lockedBy: null },
      effects: NONE,
      ...(over.simulation ?? {}),
    },
    suggestion: {
      order: [],
      firstEconomyAt: { current: null, suggested: null },
      tonnesBefore: { current: 0, suggested: 0 },
      worthIt: false,
      ...(over.suggestion ?? {}),
    },
    ...over,
  };
}

describe('the facts a plan review is built from', () => {
  it('★ MANDATORY: the simulation problems go in VERBATIM ★', () => {
    /*
     * These are the load-bearing facts — the difference between "this plan is fine" and "this plan
     * stalls at step four with a fortnight of hauling behind it". Paraphrasing them here would have
     * the model reviewing a summary rather than the plan.
     */
    const out = renderPlanFacts(
      facts({
        simulation: {
          steps: [],
          tier2: 0,
          tier3: 0,
          surchargedPorts: 0,
          problems: [
            { kind: 'points', message: 'Step 4 spends 3 tier-2 points it does not have.' },
          ],
          economy: { counts: {}, primary: null, secondary: null, locked: false, lockedBy: null },
          effects: NONE,
        },
      }),
    );

    expect(out).toContain('Step 4 spends 3 tier-2 points it does not have.');
  });

  it('★ MANDATORY: a clean plan is stated as clean, not left silent ★', () => {
    /*
     * Silence would let the model fill the gap. "No problems" said out loud is what lets it answer
     * "this looks sound" instead of finding something to justify its existence.
     */
    expect(renderPlanFacts(facts())).toMatch(/problems: none/i);
  });

  it('★ MANDATORY: a locked economy is stated as permanent ★', () => {
    /*
     * The only decision in a plan that cannot be undone. If the model is not told it is locked it
     * will happily suggest adding refinery hubs to a system that can never be a refinery.
     */
    const out = renderPlanFacts(
      facts({
        simulation: {
          steps: [],
          tier2: 0,
          tier3: 0,
          surchargedPorts: 0,
          problems: [],
          economy: {
            counts: { extraction: 6 },
            primary: 'extraction',
            secondary: null,
            locked: true,
            lockedBy: 'Mining Outpost',
          },
          effects: NONE,
        },
      }),
    );

    expect(out).toMatch(/LOCKED by Mining Outpost/);
    expect(out).toMatch(/Nothing built later can change it/);
  });

  it('★ MANDATORY: the order saving is quoted in tonnes, which is the argument ★', () => {
    const out = renderPlanFacts(
      facts({
        suggestion: {
          order: [],
          firstEconomyAt: { current: 10, suggested: 1 },
          tonnesBefore: { current: 257_206, suggested: 16_640 },
          worthIt: true,
        },
      }),
    );

    expect(out).toContain('257,206 t');
    expect(out).toContain('16,640 t');
    expect(out).toContain('240,566 t earlier');
  });

  it('MANDATORY: no better order is said so, rather than omitted', () => {
    // Omission lets the model assume there is one and invent the saving.
    expect(renderPlanFacts(facts())).toMatch(/no meaningfully better order/i);
  });

  it('MANDATORY: the plan’s own blind spot is disclosed', () => {
    // 12 of 14 bodies with no recorded slots means most of this plan rests on nothing.
    expect(renderPlanFacts(facts())).toMatch(/14, of which 12 have no recorded build slots/);
  });

  it('MANDATORY: an empty plan is refused before a model is ever called', () => {
    /*
     * Handed a plan with no builds, a model still writes a fluent review of a plan that does not
     * exist. Refusing is cheaper and more honest than generated encouragement.
     */
    expect(reviewableReason({ siteCount: 0 })).toMatch(/nothing planned yet/i);
    expect(reviewableReason({ siteCount: 1 })).toBeNull();
  });
});

describe('the rules the review is written under', () => {
  it('★ MANDATORY: the prompt forbids inventing anything the facts do not carry ★', () => {
    expect(REVIEW_PROMPT).toMatch(/ONLY those facts/);
    expect(REVIEW_PROMPT).toMatch(/Never introduce/i);
  });

  it('★ MANDATORY: it is told to say a good plan is good ★', () => {
    /*
     * The predictable failure: handed a plan with nothing wrong, a model finds something to say,
     * and invented criticism of a build order is indistinguishable from real criticism to the
     * member reading it.
     */
    expect(REVIEW_PROMPT).toMatch(/Do not invent a criticism/i);
  });

  it('MANDATORY: it is told to lead with cost, and to write for somebody who flies', () => {
    expect(REVIEW_PROMPT).toMatch(/cost the squadron most/i);
    expect(REVIEW_PROMPT).toMatch(/No field names/i);
  });
});
