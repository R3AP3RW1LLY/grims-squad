/**
 * Screening that improves from moderator decisions.
 *
 * ★ WHAT THE OWNER ASKED FOR ★
 *
 * Squadron owner, 2026-07-31: "can we train the model based on wither a moderator passes a post in
 * review or dismisses it? so that the model can get better over time?"
 *
 * ★ THE TRAP IN THE OBVIOUS VERSION, WHICH DECIDES THIS WHOLE DESIGN ★
 *
 * A moderator only ever sees posts the model FLAGGED. So the only feedback a review queue can
 * produce is:
 *
 *   released   "you were wrong to flag this"
 *   refused    "you were right to flag this"
 *
 * Nothing in that loop ever teaches it to flag MORE. A post wrongly cleared never reaches a
 * moderator, so it can never become a correction.
 *
 * Fed back naively, the model drifts steadily toward permissiveness — it only ever gets corrected in
 * one direction. That is precisely the failure of 2026-07-31 ("fuck you looser!" published),
 * except automated, and gradual enough that nobody notices until the forum is unmoderated.
 *
 * So REPORTS are load-bearing, not a nice extra. A reported post is the only source of "you should
 * have flagged this", and without it this file would make the screener worse over time while
 * appearing to learn.
 *
 * ★ WHY NOT FINE-TUNING ★
 *
 * At squadron scale this produces a handful of decisions a week. Fine-tuning wants hundreds to
 * thousands; on a small, biased set it overfits, forgets its general judgement, and gets WORSE. It
 * also costs GPU hours per policy change, against a minute for a prompt edit.
 *
 * Retrieval few-shot gives most of the benefit from the FIRST decision, is reversible by deleting a
 * row, and needs no training run. Revisit fine-tuning at a few thousand decisions — years away.
 */

/** What a decision says about the model's verdict. */
export const DECISION_SOURCES = ['review', 'report'] as const;
export type DecisionSource = (typeof DECISION_SOURCES)[number];

/**
 * A judged post, kept as an example.
 *
 * `shouldFlag` is what a HUMAN concluded, which is the label. `modelFlagged` is what the screener
 * said at the time, which is only useful for measuring drift — never as a label, or the model would
 * be learning from itself.
 */
export interface ScreenDecision {
  readonly text: string;
  /** The human's answer: should the screener have held this? */
  readonly shouldFlag: boolean;
  /** What the screener actually said, for drift measurement. */
  readonly modelFlagged: boolean;
  /**
   * Where the correction came from.
   *
   * `review` can only ever say "you over-flagged" — a moderator sees nothing else. `report` is the
   * only source of "you under-flagged", which is why both exist.
   */
  readonly source: DecisionSource;
}

/**
 * How many past decisions are shown to the model when screening a new post.
 *
 * ★ FIVE, AND NOT MORE ★
 *
 * These are prepended to every screening call, so they cost latency and context on every post. Five
 * near-neighbours carry the local shape of the rule — how THIS squadron judges THIS kind of post —
 * without turning a 200-token prompt into a 2,000-token one and pushing the actual post to the end,
 * where models attend to it least.
 */
export const FEWSHOT_LIMIT = 5;

/**
 * How similar a past decision must be before it is worth showing.
 *
 * ★ MEASURED, NOT GUESSED ★
 *
 * Cosine similarity from nomic-embed-text on 2026-07-31, against "you are a useless idiot, get
 * lost":
 *
 *   0.471   "fuck you looser!"                 same kind of thing
 *   0.305   "that run was fucking brutal"      profanity, different intent
 *   0.290   "Anyone up for mining this weekend?"  unrelated
 *
 * 0.40 sits above the profanity-but-unrelated band and below the genuinely-similar one. Below this
 * an example is noise, and a misleading example is worse than none: it teaches the model that an
 * unrelated post is precedent.
 */
export const FEWSHOT_MIN_SIMILARITY = 0.4;

/** The embedding model, and its dimensionality. Both are needed by the migration. */
export const EMBED_MODEL = 'nomic-embed-text';
export const EMBED_DIMS = 768;

/**
 * Formats retrieved decisions for the prompt.
 *
 * ★ SHOWN AS PRECEDENT, NOT AS RULES ★
 *
 * Worded as what officers decided about similar posts, because that is what it is. Presented as
 * rules, a handful of examples would override the general instructions — and five near-neighbours
 * are a far narrower view of the policy than the prompt itself.
 */
export function fewshotBlock(examples: readonly ScreenDecision[]): string {
  if (examples.length === 0) return '';

  const lines = examples.map(
    (e) => `- ${JSON.stringify(e.text.slice(0, 200))} -> ${e.shouldFlag ? 'FLAGGED' : 'allowed'}`,
  );

  return `\n\nOfficers of this squadron judged these similar posts. Follow their lead where the case is close:\n${lines.join('\n')}`;
}

/**
 * When to warn that the screener is drifting.
 *
 * ★ THE ALARM FOR THE FAILURE THIS FILE COULD CAUSE ★
 *
 * If moderators release nearly everything the model flags, the model is too strict — annoying, and
 * self-correcting through this loop. If reports keep arriving for posts it cleared, it is too
 * permissive, which is the dangerous direction and the one the review queue cannot see.
 *
 * Measured over a rolling window so a single odd week does not trigger it, and reported on the live
 * log where somebody is already looking.
 */
export const DRIFT = {
  /** Decisions needed before the rates mean anything. Below this, silence. */
  minSample: 20,
  /** Released this often, and the screener is crying wolf. */
  releaseRateHigh: 0.8,
  /** Reports upheld this often, and it is letting real harm through. */
  reportUpheldHigh: 0.5,
} as const;
