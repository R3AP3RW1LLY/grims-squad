import { describe, it, expect } from 'vitest';
import {
  BANNER_HEIGHT,
  BANNER_WIDTH,
  IMAGE_CFG,
  IMAGE_GEN_HEIGHT,
  IMAGE_GEN_WIDTH,
  IMAGE_STEPS,
  MAX_PROMPT_LENGTH,
  MAX_SEED,
  PROMPT_EXAMPLES,
  PROMPT_GUIDANCE,
  buildImagePrompt,
} from '@grims/shared';

/**
 * The arithmetic the image pipeline quietly depends on.
 *
 * ★ WHY A TEST FOR FOUR CONSTANTS ★
 *
 * Every one of these was got wrong once while writing it, and none of them fail loudly.
 *
 * The generation size started at 1216×320 — a perfectly reasonable multiple of sixteen, and 3.80:1
 * against the banner's 3.75:1. With `fit: 'fill'` doing the downscale, that stretches every banner
 * by about one percent. Nobody reviewing a nebula would ever notice, and it would have been in
 * every signature the squadron produced.
 *
 * That is the shape of all of these: constraints that hold today by intent, are invisible when
 * broken, and sit in a file somebody will reasonably edit to "just make the images a bit bigger".
 */

describe('generation size against banner size', () => {
  it('MANDATORY: is an exact integer multiple, so nothing is stretched', () => {
    /*
     * `toBannerSize` uses fit:'fill', which does exactly what it is told and never crops. That is
     * the right choice — cropping would silently discard part of the image the member approved in
     * the preview — but it only distorts nothing while the ratio is exact.
     */
    expect(IMAGE_GEN_WIDTH / BANNER_WIDTH).toBe(IMAGE_GEN_HEIGHT / BANNER_HEIGHT);
    expect(Number.isInteger(IMAGE_GEN_WIDTH / BANNER_WIDTH)).toBe(true);
  });

  it('generates larger than it publishes — the downscale is the quality step', () => {
    // Generating AT banner size is the obvious simplification and produces visibly softer output.
    expect(IMAGE_GEN_WIDTH).toBeGreaterThan(BANNER_WIDTH);
  });

  it('MANDATORY: both generated axes are multiples of 16, as FLUX requires', () => {
    /*
     * FLUX works in a latent downscaled by 8 then patched by 2. An unsupported size does not
     * error — it is rounded, and the image comes back a different shape to the one the layout
     * expects, which then gets stretched by the resize.
     */
    expect(IMAGE_GEN_WIDTH % 16).toBe(0);
    expect(IMAGE_GEN_HEIGHT % 16).toBe(0);
  });
});

describe('sampler settings suit a distilled model', () => {
  it('MANDATORY: guidance stays at 1.0', () => {
    /*
     * Schnell is guidance-distilled. Raising cfg does not sharpen the image, it produces the
     * blown-out oversaturated look people misread as a bad prompt — and it silently makes the
     * empty negative prompt start mattering.
     */
    expect(IMAGE_CFG).toBe(1.0);
  });

  it('stays in the few-step range schnell is trained for', () => {
    expect(IMAGE_STEPS).toBeGreaterThanOrEqual(1);
    expect(IMAGE_STEPS).toBeLessThanOrEqual(8);
  });
});

describe('prompt building', () => {
  it("MANDATORY: keeps the guidance that suppresses text in the artwork", () => {
    /*
     * The single most likely complaint about this feature is lettering rendered into the backdrop
     * behind the real SVG lettering. The guidance is what prevents it, and it must survive whatever
     * the member typed.
     */
    const out = buildImagePrompt('my commander name in big letters');
    expect(out).toContain('no text');
    expect(out).toContain(PROMPT_GUIDANCE);
  });

  it('an empty prompt still generates something, rather than an empty request', () => {
    expect(buildImagePrompt('   ')).toBe(PROMPT_GUIDANCE);
  });

  it('bounds what a member can type', () => {
    const out = buildImagePrompt('x'.repeat(MAX_PROMPT_LENGTH * 3));
    // The member's portion is capped; the guidance is appended after and is not part of the cap.
    expect(out.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH + PROMPT_GUIDANCE.length + 2);
  });

  it('collapses whitespace so a pasted paragraph does not waste the budget', () => {
    expect(buildImagePrompt('blue   nebula\n\n  drifting')).toContain('blue nebula drifting');
  });

  it('the examples are usable as-is', () => {
    // They are shown as one-click starting points, so an empty or oversized one is a broken button.
    for (const ex of PROMPT_EXAMPLES) {
      expect(ex.trim().length).toBeGreaterThan(20);
      expect(ex.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
    }
  });
});

describe('seeds', () => {
  it('MANDATORY: stay in the range JavaScript can represent exactly', () => {
    /*
     * ComfyUI takes a 64-bit seed. A seed above 2^53 does not survive a round trip through JSON —
     * it comes back a nearby number, generates a different image, and "reproduce this one" quietly
     * stops working. Capped where the arithmetic is still exact.
     */
    expect(MAX_SEED).toBe(Number.MAX_SAFE_INTEGER);
  });
});
