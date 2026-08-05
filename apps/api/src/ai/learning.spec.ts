import { describe, it, expect } from 'vitest';
import {
  DRIFT,
  FEWSHOT_LIMIT,
  FEWSHOT_MIN_SIMILARITY,
  fewshotBlock,
  type ScreenDecision,
} from '@grims/shared';

/**
 * The feedback loop, and the bias it must not have.
 *
 * ★ THE FAILURE THIS GUARDS ★
 *
 * A moderator only ever sees posts the model FLAGGED, so a review queue can only ever say "you
 * over-flagged". Nothing in it teaches the screener to flag MORE.
 *
 * Fed back naively, that drifts steadily toward permissiveness — which is exactly the bug of
 * 2026-07-31 ("fuck you looser!" published), except automated and slow enough that nobody notices
 * until the forum is effectively unmoderated.
 *
 * Reports are the other half, and the drift alarm is the tripwire.
 */

const ex = (text: string, shouldFlag: boolean, source: 'review' | 'report' = 'review'): ScreenDecision => ({
  text,
  shouldFlag,
  modelFlagged: true,
  source,
});

describe('precedent shown to the model', () => {
  it('MANDATORY: no examples means the prompt is unchanged', () => {
    /*
     * The normal case on a fresh install, and whenever the embedding model is unreachable. It must
     * be byte-identical to screening without this feature, or turning the loop on would silently
     * change every verdict.
     */
    expect(fewshotBlock([])).toBe('');
  });

  it('carries the human verdict, not the model’s', () => {
    const block = fewshotBlock([ex('fuck you looser!', true), ex('FIRST POST HERE Fuckers!', false)]);
    expect(block).toMatch(/fuck you looser!.*FLAGGED/s);
    expect(block).toMatch(/FIRST POST HERE Fuckers!.*allowed/s);
  });

  it('MANDATORY: presents examples as precedent, not as rules', () => {
    /*
     * Five near-neighbours are a much narrower view of policy than the prompt itself. Worded as
     * rules they would override it; worded as what officers decided, they inform the close cases
     * and leave the general instruction standing.
     */
    const block = fewshotBlock([ex('x', true)]);
    expect(block).toMatch(/officers of this squadron judged/i);
    expect(block).not.toMatch(/you must|always flag|never flag/i);
  });

  it('bounds how much of a post it quotes', () => {
    // A whole guide pasted into every screening prompt would push the actual post to the end, where
    // models attend to it least.
    const block = fewshotBlock([ex('x'.repeat(2_000), true)]);
    expect(block.length).toBeLessThan(600);
  });
});

describe('retrieval settings', () => {
  it('MANDATORY: the similarity floor sits above the unrelated band', () => {
    /*
     * Measured 2026-07-31 with nomic-embed-text against "you are a useless idiot, get lost":
     *   0.471  "fuck you looser!"                    genuinely similar
     *   0.305  "that run was fucking brutal"         profanity, different intent
     *   0.290  "Anyone up for mining this weekend?"  unrelated
     *
     * The floor must exclude the second — profanity alone is NOT precedent, and that confusion is
     * what caused both screening bugs so far.
     */
    expect(FEWSHOT_MIN_SIMILARITY).toBeGreaterThan(0.305);
    expect(FEWSHOT_MIN_SIMILARITY).toBeLessThan(0.471);
  });

  it('keeps the example count small', () => {
    // Prepended to EVERY screening call, so this is latency and context on every post.
    expect(FEWSHOT_LIMIT).toBeLessThanOrEqual(8);
  });
});

describe('MANDATORY: the drift alarm watches BOTH directions', () => {
  it('has a threshold for too strict and one for too permissive', () => {
    /*
     * Only watching releases would catch the harmless direction and miss the dangerous one. The
     * review queue cannot see false negatives at all — only reports can — so the two rates are
     * tracked separately and neither substitutes for the other.
     */
    expect(DRIFT.releaseRateHigh).toBeGreaterThan(0);
    expect(DRIFT.reportUpheldHigh).toBeGreaterThan(0);
  });

  it('stays silent on a small sample', () => {
    // Three decisions is not a trend, and an alarm that cries wolf gets ignored when it matters.
    expect(DRIFT.minSample).toBeGreaterThanOrEqual(10);
  });
});
