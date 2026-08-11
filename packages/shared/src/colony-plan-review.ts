import type { OrderSuggestion } from './colony-order.js';
import type { SimResult } from './colony-simulation.js';

/**
 * What a language model is allowed to know about a build plan.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * Chose "AI plan review" from the colonisation suggestions: read my plan and tell me what is wrong
 * with it.
 *
 * ★ THE MODEL SUPPLIES SENTENCES; THE SIMULATION SUPPLIES FACTS ★
 *
 * The same ordering the assistant is built on, and the reason it can say "I do not know" instead of
 * inventing. Every number below is computed by `simulatePlan` and `suggestBuildOrder` — the model
 * is handed the findings and asked to explain and prioritise them, never to work them out.
 *
 * That matters more here than almost anywhere else on the platform. A confidently wrong sentence
 * about a build order costs a squadron a fortnight of hauling, and they will not come back to check
 * whether the tool was right — they will conclude it does not work.
 *
 * ★ SO THIS FUNCTION IS PURE, AND TESTED ★
 *
 * It decides what the model is told. A review is only as honest as its facts, and facts assembled
 * inside a service that also makes a network call are facts nobody can hold still and check.
 */

export interface PlanFacts {
  readonly systemName: string;
  readonly siteCount: number;
  readonly totalTonnes: number;
  readonly simulation: SimResult;
  readonly suggestion: OrderSuggestion;
  /** Bodies whose build slots nobody has recorded — the plan's own blind spot. */
  readonly bodiesWithoutSlots: number;
  readonly bodyCount: number;
}

/**
 * The rules the review is written under.
 *
 * ★ WRITTEN AS PROHIBITIONS, BECAUSE THAT IS WHAT FAILS ★
 *
 * A prompt asking for a helpful review produces a helpful review. The failure worth engineering
 * against is the predictable one: handed a plan with nothing much wrong, a model will find
 * something to say — and invented criticism of a build order is indistinguishable from real
 * criticism to the member reading it.
 */
export const REVIEW_PROMPT = [
  'You are reviewing an Elite Dangerous system colonisation plan for the squadron that will build it.',
  '',
  'You are given FACTS computed by the simulation. Rules:',
  '- Use ONLY those facts. Never introduce a build type, tonnage, cost or rule that is not in them.',
  '- If the facts show nothing wrong, say the plan looks sound. Do not invent a criticism.',
  '- Never guess at game mechanics. The facts already encode the rules that matter.',
  '- Lead with what would cost the squadron most, not with what is easiest to say.',
  '- Write for somebody who flies, not somebody who codes. No field names, no JSON.',
  '- Be brief: at most one short paragraph, then at most four bullets.',
  '- Tonnages are hours of somebody\'s life. Quote them when they make the point.',
].join('\n');

/**
 * The facts, rendered for the model.
 *
 * Plain lines rather than JSON: the model reads them better, and — more importantly — a human
 * reviewing a bad answer can see exactly what it was told, which is the only way to tell a wrong
 * fact from a wrong sentence.
 */
export function renderPlanFacts(f: PlanFacts): string {
  const lines: string[] = [
    `System: ${f.systemName}`,
    `Sites planned: ${f.siteCount}`,
    `Total to haul: ${f.totalTonnes.toLocaleString()} t`,
    `Bodies: ${f.bodyCount}, of which ${f.bodiesWithoutSlots} have no recorded build slots`,
  ];

  const { economy, effects, problems, steps } = f.simulation;

  if (economy.primary !== null) {
    lines.push(
      `Economy this plan produces: ${economy.primary}` +
        (economy.secondary === null ? '' : `, with ${economy.secondary} second`),
    );
    if (economy.locked) {
      lines.push(
        `The economy is LOCKED by ${economy.lockedBy}, which opens the order. Nothing built later can change it.`,
      );
    }
  } else {
    lines.push('Economy this plan produces: nothing yet — no build in the plan votes for one.');
  }

  /*
   * The problems the simulation found, verbatim. These are the load-bearing facts: they are the
   * difference between "this plan is fine" and "this plan stalls at step four with a fortnight of
   * hauling behind it", and paraphrasing them here would be the model reviewing my summary rather
   * than the plan.
   */
  if (problems.length === 0) {
    lines.push('Simulation problems: none. Every step is payable in construction points.');
  } else {
    lines.push('Simulation problems:');
    for (const p of problems) lines.push(`  - ${p.message}`);
  }

  const negative = steps.filter((s) => s.tier2 < 0 || s.tier3 < 0);
  if (negative.length > 0) {
    const first = negative[0];
    lines.push(
      `First step that goes construction-point negative: step ${steps.indexOf(first as (typeof steps)[number]) + 1}` +
        ` (tier 2 balance ${first?.tier2}, tier 3 balance ${first?.tier3}).`,
    );
  }

  if (f.suggestion.worthIt && f.suggestion.firstEconomyAt.suggested !== null) {
    const saved = f.suggestion.tonnesBefore.current - f.suggestion.tonnesBefore.suggested;
    lines.push(
      `A better build order exists: the first economy build currently lands at step ` +
        `${(f.suggestion.firstEconomyAt.current ?? f.siteCount) + 1} after ` +
        `${f.suggestion.tonnesBefore.current.toLocaleString()} t of hauling; reordering puts one at ` +
        `step ${f.suggestion.firstEconomyAt.suggested + 1} after ` +
        `${f.suggestion.tonnesBefore.suggested.toLocaleString()} t — ${saved.toLocaleString()} t earlier.`,
    );
  } else {
    lines.push('Build order: no meaningfully better order was found.');
  }

  const shifts = Object.entries(effects).filter(([, v]) => v !== 0);
  if (shifts.length > 0) {
    lines.push(
      `Effects on the system if the whole plan is built: ${shifts
        .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`)
        .join(', ')}.`,
    );
  }

  return lines.join('\n');
}

/**
 * Whether a plan is even worth asking about.
 *
 * ★ AN EMPTY PLAN HAS NOTHING TO REVIEW, AND SAYING SO COSTS NOTHING ★
 *
 * Handed a plan with no builds in it, a model will still write a review — a fluent one, about a
 * plan that does not exist. Refusing here is both cheaper and more honest than a paragraph of
 * generated encouragement, and it keeps the model's time for plans that have something in them.
 */
export function reviewableReason(f: Pick<PlanFacts, 'siteCount'>): string | null {
  if (f.siteCount === 0) {
    return 'There is nothing planned yet. Add some builds to the bodies and I can look at the order.';
  }
  return null;
}
