import { describe, it, expect } from 'vitest';
import {
  BANNER,
  BANNER_LIMITS,
  defaultBannerSpec,
  validateBannerSpec,
} from './forum-signature.js';

/**
 * Banner spec validation.
 *
 * ★ WHAT A SPEC ACTUALLY IS ★
 *
 * A small program describing what to draw, arriving from a browser. Our own editor produced it,
 * which is not a reason to trust it — the editor is JavaScript running on somebody else's machine,
 * and what reaches the server is whatever that machine sent.
 *
 * ★ THE RULE: CLAMP NUMBERS, REFUSE STRUCTURE ★
 *
 * A size of 9999 is a slider bug or an older client, and throwing away somebody's whole banner over
 * it would be a bad trade — so it is clamped. A background nobody defined has no sensible
 * substitute, so it is refused. The tests below are mostly about keeping that line in one place.
 */

const base = {
  version: 1 as const,
  background: 'gradient' as const,
  colourA: 'dark' as const,
  colourB: 'orange' as const,
  dim: 0,
  layers: [],
};

describe('banner specs', () => {
  describe('the default', () => {
    it('is a real banner, not an empty canvas', () => {
      /*
       * An empty rectangle is the hardest thing to hand somebody. The generator opens on a finished
       * banner they change, rather than one they have to build from nothing.
       */
      const spec = defaultBannerSpec();
      expect(spec.layers.length).toBeGreaterThan(0);
      expect(validateBannerSpec(spec)).toEqual(spec);
    });

    it('survives a round trip through validation unchanged', () => {
      // If the default did not validate, every member would meet an error on first save.
      expect(validateBannerSpec(defaultBannerSpec())).toEqual(defaultBannerSpec());
    });
  });

  describe('MANDATORY: refuses structure it does not recognise', () => {
    it('a background nobody defined', () => {
      expect(() => validateBannerSpec({ ...base, background: 'chartreuse' })).toThrow();
    });

    it('a layer kind nobody defined', () => {
      expect(() =>
        validateBannerSpec({ ...base, layers: [{ kind: 'iframe', anchor: 'top-left' }] }),
      ).toThrow();
    });

    it('a badge that is not one of ours', () => {
      /*
       * Badges are named, never image ids. If this accepted arbitrary names it would become a
       * second image pipeline with none of the fitting or ownership rules the background has.
       */
      expect(() =>
        validateBannerSpec({
          ...base,
          layers: [{ kind: 'badge', badge: 'somebody-elses-logo', anchor: 'top-left', size: 40 }],
        }),
      ).toThrow();
    });

    it('a version from a different editor', () => {
      expect(() => validateBannerSpec({ ...base, version: 2 })).toThrow();
    });

    it('null, a string, and a number', () => {
      expect(() => validateBannerSpec(null)).toThrow();
      expect(() => validateBannerSpec('banner')).toThrow();
      expect(() => validateBannerSpec(42)).toThrow();
    });

    it('more layers than the limit', () => {
      const many = Array.from({ length: BANNER_LIMITS.maxLayers + 1 }, () => ({
        kind: 'text',
        source: 'custom',
        text: 'x',
        anchor: 'top-left',
        size: 12,
      }));
      expect(() => validateBannerSpec({ ...base, layers: many })).toThrow();
    });
  });

  describe('clamps numbers rather than losing the banner', () => {
    it('a text size past the maximum', () => {
      const out = validateBannerSpec({
        ...base,
        layers: [{ kind: 'text', source: 'custom', text: 'x', anchor: 'top-left', size: 9999 }],
      });
      expect(out.layers[0]?.size).toBe(BANNER_LIMITS.maxTextSize);
    });

    it('a negative size', () => {
      const out = validateBannerSpec({
        ...base,
        layers: [{ kind: 'text', source: 'custom', text: 'x', anchor: 'top-left', size: -40 }],
      });
      expect(out.layers[0]?.size).toBe(BANNER_LIMITS.minTextSize);
    });

    it('a dim past the maximum', () => {
      // Capped below 100 on purpose: a fully black veil hides the picture entirely, which is a
      // state somebody reaches by dragging and then reports as "my banner disappeared".
      expect(validateBannerSpec({ ...base, dim: 999 }).dim).toBe(BANNER_LIMITS.maxDim);
    });

    it('NaN and non-numbers fall back rather than propagating', () => {
      /*
       * A NaN reaching the renderer produces `width="NaN"`, which draws nothing and looks like a
       * blank banner. Substituting the default keeps a bad value from becoming an invisible one.
       */
      const out = validateBannerSpec({
        ...base,
        dim: Number.NaN,
        layers: [
          { kind: 'text', source: 'custom', text: 'x', anchor: 'top-left', size: 'big' },
        ],
      });
      expect(out.dim).toBe(0);
      expect(Number.isFinite(out.layers[0]?.size)).toBe(true);
    });

    it('an anchor nobody defined falls back to a real one', () => {
      const out = validateBannerSpec({
        ...base,
        layers: [{ kind: 'text', source: 'custom', text: 'x', anchor: 'somewhere', size: 12 }],
      });
      expect(out.layers[0]?.anchor).toBe('middle-left');
    });
  });

  describe('text layers', () => {
    it('truncates custom text rather than refusing it', () => {
      const out = validateBannerSpec({
        ...base,
        layers: [
          { kind: 'text', source: 'custom', text: 'x'.repeat(500), anchor: 'top-left', size: 12 },
        ],
      });
      const layer = out.layers[0] as { text?: string };
      expect(layer.text?.length).toBe(BANNER_LIMITS.maxCustomText);
    });

    it('MANDATORY: a non-custom layer carries no stored text', () => {
      /*
       * A `rank` layer resolves at RENDER time. If it also carried stored text, a promotion would
       * leave the old rank sitting in the spec — and whichever of the two the renderer happened to
       * prefer would decide whether the banner was right, which is not a decision worth having.
       */
      const out = validateBannerSpec({
        ...base,
        layers: [
          { kind: 'text', source: 'rank', text: 'Cadet forever', anchor: 'top-left', size: 12 },
        ],
      });
      expect(out.layers[0]).not.toHaveProperty('text');
    });

    it('an unknown colour falls back to something legible', () => {
      // Never to an arbitrary value: an unknown colour reaching the renderer as a CSS string is
      // how a member ends up with invisible text on their own banner.
      const out = validateBannerSpec({
        ...base,
        layers: [
          { kind: 'text', source: 'custom', text: 'x', anchor: 'top-left', size: 12, colour: '#000' },
        ],
      });
      expect(out.layers[0]).toMatchObject({ colour: 'light' });
    });
  });

  describe('the background image', () => {
    it('MANDATORY: carries a media id and has nowhere to put a URL', () => {
      /*
       * The spec has no URL field at all. A banner therefore cannot reference a third-party host —
       * the same structural guarantee the rich document has, for the same reason: `img-src 'self'`
       * should hold because there is nowhere to write a foreign address, not because somebody
       * remembered to check.
       */
      const out = validateBannerSpec({
        ...base,
        background: 'image',
        imageMediaId: 'abc',
        imageUrl: 'https://evil.test/x.png',
      });
      expect(out.imageMediaId).toBe('abc');
      expect(JSON.stringify(out)).not.toContain('evil.test');
    });

    it('drops an empty media id rather than storing a blank reference', () => {
      const out = validateBannerSpec({ ...base, background: 'image', imageMediaId: '' });
      expect(out).not.toHaveProperty('imageMediaId');
    });
  });

  describe('the fixed size', () => {
    it('is 600 × 120 with a stated floor for uploads', () => {
      // Pinned so the number in the UI copy, the server message and the renderer cannot drift.
      expect([BANNER.width, BANNER.height]).toEqual([600, 120]);
      expect(BANNER.minUploadWidth).toBeLessThan(BANNER.width);
      expect(BANNER.minUploadHeight).toBeLessThan(BANNER.height);
    });
  });
});
