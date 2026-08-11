import { Injectable, Inject } from '@nestjs/common';
import { REVIEW_PROMPT, renderPlanFacts, reviewableReason, type PlanFacts } from '@grims/shared';
import { AiClient } from '../ai/ai.client.js';
import { ColonyPlanService } from './colony-plan.service.js';

/**
 * "Read my plan and tell me what is wrong with it."
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * Chosen from the colonisation suggestions. The planner already SAYS whether a plan is payable and
 * what it becomes; nothing reads those findings back to somebody in their own language, or decides
 * which of eleven problems is the one that will cost them a fortnight.
 *
 * ★ THE MODEL SUPPLIES SENTENCES; THE SIMULATION SUPPLIES FACTS ★
 *
 * The same ordering the assistant is built on, and the reason it can say "this looks sound" instead
 * of inventing a criticism. Every number handed over is computed by `simulatePlan` and
 * `suggestBuildOrder` — the model explains and prioritises, and works nothing out.
 *
 * That matters more here than almost anywhere. A confidently wrong sentence about a build order
 * costs a squadron a fortnight of hauling, and they will not come back to check whether the tool
 * was right — they will conclude it does not work.
 *
 * ★ AND THE FACTS COME BACK WITH THE ANSWER ★
 *
 * Not decoration: it is the only way a member can tell a retrieved fact from a generated sentence,
 * and the only way anybody reviewing a bad review can tell whether the data was wrong or the model
 * was.
 */

export interface PlanReview {
  /** The model's words. Empty when it could not be reached — see `unavailable`. */
  readonly review: string;
  /** Exactly what the model was told, verbatim. */
  readonly facts: string;
  /** Set when there was nothing to review, or the model could not be reached. */
  readonly unavailable: string | null;
}

@Injectable()
export class ColonyPlanReviewService {
  constructor(
    @Inject(ColonyPlanService) private readonly plans: ColonyPlanService,
    @Inject(AiClient) private readonly ai: AiClient,
  ) {}

  async review(planId: string, callerId: string): Promise<PlanReview | null> {
    const plan = await this.plans.byId(planId, callerId);
    if (plan === null) return null;

    const facts: PlanFacts = {
      systemName: plan.systemName,
      siteCount: plan.sites.length,
      totalTonnes: plan.sites.reduce((n, s) => n + (s.totalTonnes ?? 0), 0),
      simulation: plan.simulation,
      suggestion: plan.suggestion,
      bodyCount: plan.bodies.length,
      bodiesWithoutSlots: plan.bodies.filter(
        (b) => (b.orbitalSlots ?? 0) + (b.surfaceSlots ?? 0) === 0,
      ).length,
    };

    /*
     * Refused before a model is ever called. Handed a plan with no builds in it a model still
     * writes a fluent review — of a plan that does not exist — and that is worse than silence
     * because it reads exactly like a real one.
     */
    const nothing = reviewableReason(facts);
    if (nothing !== null) return { review: '', facts: '', unavailable: nothing };

    const rendered = renderPlanFacts(facts);
    const answer = await this.ai.ask(REVIEW_PROMPT, [
      { role: 'user', content: `FACTS:\n${rendered}\n\nReview this plan.` },
    ]);

    /*
     * ★ THE FACTS SURVIVE AN UNREACHABLE MODEL ★
     *
     * `AiClient.ask` answers null when the AI is not reachable — which, on this platform, means a
     * tunnel to a machine in the owner's house. The findings are still true and still worth reading,
     * so they are returned either way and the page says which half is missing rather than showing
     * an error where a review should be.
     */
    if (answer === null) {
      return {
        review: '',
        facts: rendered,
        unavailable:
          'The assistant is not reachable at the moment. What the simulation found is below.',
      };
    }

    return { review: answer, facts: rendered, unavailable: null };
  }
}
