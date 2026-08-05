import type { ScreenDecision, ScreenResult } from '@grims/shared';
import type { AiClient } from './ai.client.js';
import type { AiLog } from './ai-log.port.js';

/**
 * Deciding whether a post may be read.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "the ai must ingest and moderate all posts before they are visible / posted to the forum!"
 *
 * So this runs on the WRITE path, synchronously, before the post is created — and its answer
 * decides the post's `screen_state`. There is no window in which unscreened writing is readable,
 * because a post is never written without a verdict attached.
 *
 * ★ THREE OUTCOMES, TWO OF WHICH LOOK THE SAME TO A READER ★
 *
 *   clear       → published
 *   flagged     → held for a human
 *   unavailable → held for a human
 *
 * The last two are different facts and the same consequence. The moderation queue tells them apart
 * — an officer reviewing a backlog wants to know whether the model objected or whether the GPU was
 * simply off — but a reader gets the same outcome either way, which is the point of the rule.
 *
 * ★ THE AUTHOR IS NEVER TOLD WHICH CATEGORY FIRED ★
 *
 * Owner's decision, same day. Naming the category teaches anybody determined exactly which wording
 * gets through, and they can retry as often as they like. So the verdict is stored for the officer
 * and the author is told only that it is waiting.
 */

export interface ScreenOutcome {
  readonly state: 'clear' | 'held';
  /** The full verdict, stored for the reviewer. Never returned to the author. */
  readonly verdict: ScreenResult;
}

export class ScreeningService {
  constructor(
    private readonly ai: AiClient,
    private readonly log: AiLog,
    /*
     * Optional. Without it screening behaves exactly as it did before the feedback loop existed —
     * which is what a unit test wants, and what a fresh install gets until officers have judged
     * anything.
     */
    private readonly decisions: { similar(text: string): Promise<ScreenDecision[]> } | null = null,
  ) {}

  /**
   * Screens text destined for the forum.
   *
   * ★ WHY AN UNCONFIGURED AI CLEARS RATHER THAN HOLDS ★
   *
   * This is the one place the rule bends, and deliberately. `AI_BASE_URL` unset means screening was
   * never turned on — a development machine, or production before the tunnel exists. Holding every
   * post in that state would mean the forum silently stops working the moment this code deploys,
   * for a reason nobody would connect to a feature they had not enabled yet.
   *
   * CONFIGURED-BUT-UNREACHABLE is the case the owner actually decided, and that holds: the AI is
   * meant to be running, it is not, so a human looks. The difference is intent — one is "not
   * enabled", the other is "enabled and broken".
   */
  async screenPost(
    text: string,
    context: { userId: string; surface: string },
  ): Promise<ScreenOutcome> {
    if (!this.ai.configured) {
      return {
        state: 'clear',
        verdict: { verdict: 'clear', categories: [], reason: null, tookMs: 0 },
      };
    }

    /*
     * Precedent first, then the verdict. Retrieval is a few milliseconds against an HNSW index and
     * returns nothing at all when the decision store is empty or the embedding model is down, so
     * the cost on the post path is real but small and the failure mode is "screen as before".
     */
    const precedent = this.decisions === null ? [] : await this.decisions.similar(text);
    const verdict = await this.ai.screen(text, precedent);

    /*
     * Logged before the decision is returned, and never awaited into the failure path: a post must
     * not be lost because the log write failed. The log is evidence, not a gate.
     */
    void this.log
      .record({
        userId: context.userId,
        kind: 'screen',
        surface: context.surface,
        // Truncated. A whole forum post in a log line makes the review screen unreadable, and the
        // post itself is one click away from the queue entry.
        prompt: text.slice(0, 2_000),
        response: verdict.reason,
        tookMs: verdict.tookMs,
      })
      .catch(() => undefined);

    return { state: verdict.verdict === 'clear' ? 'clear' : 'held', verdict };
  }
}

/**
 * What the author is told when their post is held.
 *
 * ★ ONE MESSAGE FOR BOTH REASONS ★
 *
 * Flagged and unavailable produce identical wording, because the alternative leaks the verdict by
 * implication: "held for review" versus "the checker is offline" tells a member which one happened,
 * and therefore whether the model objected to what they wrote.
 *
 * It says what happened, that a person will look, and does not apologise or explain. A member whose
 * perfectly ordinary post was held by a jumpy model should not be made to feel accused.
 */
export const HELD_MESSAGE =
  'Your post has been held for an officer to look at before it goes up. You will hear back shortly.';
