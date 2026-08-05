import { describe, it, expect } from 'vitest';
import {
  BANNER,
  BANNER_LIMITS,
  defaultBannerSpec,
  validateBannerSpec,
  type BannerLayer,
  type BannerTextLayer,
} from './forum-signature.js';

/**
 * Narrows a validated layer to a text layer, failing the test if it is not one.
 *
 * ★ WHY THIS EXISTS RATHER THAN A CAST ★
 *
 * `BannerLayer` is a union and only the text arm has `colour`, so `layers[0]?.colour` does not
 * compile. The tempting fix is `as BannerTextLayer`, which silences the compiler and would keep
 * passing if validation ever started returning a BADGE layer where a text layer was expected —
 * reading `colour` off it as undefined and asserting against undefined.
 *
 * This asserts the kind first, so that regression fails loudly on the line that caused it.
 */
function asText(layer: BannerLayer | undefined): BannerTextLayer {
  expect(layer?.kind).toBe('text');
  return layer as BannerTextLayer;
}

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
  version: 2 as const,
  background: 'gradient' as const,
  colourA: '#0b0f14',
  colourB: '#ff7100',
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
          layers: [{ kind: 'badge', badge: 'somebody-elses-logo', row: 1, size: 40 }],
        }),
      ).toThrow();
    });

    it('a version from a different editor', () => {
      expect(() => validateBannerSpec({ ...base, version: 99 })).toThrow();
    });

    it('MANDATORY: reads a version 1 banner rather than refusing it', () => {
      /*
       * Version 1 shipped and members built banners with it. Refusing those would blank their
       * signature with no explanation and no way back — the spec is the only copy, so "rebuild it"
       * would mean "your work is gone". The nine anchors were three rows crossed with three
       * alignments, and the palette names were always hex underneath.
       */
      const v1 = {
        version: 1,
        background: 'gradient',
        colourA: 'dark',
        colourB: 'orange',
        dim: 0,
        layers: [
          { kind: 'text', source: 'rank', anchor: 'bottom-right', size: 14, colour: 'cyan' },
        ],
      };
      const out = validateBannerSpec(v1);
      expect(out.version).toBe(2);
      expect(out.colourA).toBe('#0b0f14');
      expect(out.layers[0]).toMatchObject({ row: 3, align: 'right', source: 'squadronRank' });
      expect(asText(out.layers[0]).colour).toBe('#5cd9ff');
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
        row: 1,
        size: 12,
      }));
      expect(() => validateBannerSpec({ ...base, layers: many })).toThrow();
    });
  });

  describe('clamps numbers rather than losing the banner', () => {
    it('a text size past the maximum', () => {
      const out = validateBannerSpec({
        ...base,
        layers: [{ kind: 'text', source: 'custom', text: 'x', row: 1, size: 9999 }],
      });
      expect(out.layers[0]?.size).toBe(BANNER_LIMITS.maxTextSize);
    });

    it('a negative size', () => {
      const out = validateBannerSpec({
        ...base,
        layers: [{ kind: 'text', source: 'custom', text: 'x', row: 1, size: -40 }],
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
          { kind: 'text', source: 'custom', text: 'x', row: 1, size: 'big' },
        ],
      });
      expect(out.dim).toBe(0);
      expect(Number.isFinite(out.layers[0]?.size)).toBe(true);
    });

    it('a row or side nobody defined falls back to a real one', () => {
      const out = validateBannerSpec({
        ...base,
        layers: [{ kind: 'text', source: 'custom', text: 'x', row: 9, align: 'sideways', size: 12 }],
      });
      expect(out.layers[0]).toMatchObject({ row: 2, align: 'left' });
    });
  });

  describe('text layers', () => {
    it('truncates custom text rather than refusing it', () => {
      const out = validateBannerSpec({
        ...base,
        layers: [
          { kind: 'text', source: 'custom', text: 'x'.repeat(500), row: 1, size: 12 },
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
          { kind: 'text', source: 'combat', text: 'Harmless forever', row: 1, size: 12 },
        ],
      });
      expect(out.layers[0]).not.toHaveProperty('text');
    });

    it('an unknown colour falls back to something legible', () => {
      // Never to an arbitrary value: an unknown colour reaching the renderer as a CSS string is
      // how a member ends up with invisible text on their own banner.
      const out = validateBannerSpec({
        ...base,
        layers: [{ kind: 'text', source: 'custom', text: 'x', row: 1, size: 12, colour: 'chartreuse' }],
      });
      // Falls back to a legible default rather than reaching the renderer as an unvalidated CSS
      // string. `#000` IS valid CSS but not our format — six digits, so the parser is unambiguous.
      expect(asText(out.layers[0]).colour).toBe('#e8eef5');
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
      expect([BANNER.width, BANNER.height]).toEqual([600, 160]);
      expect(BANNER.rows).toBe(3);
      expect(BANNER.minUploadWidth).toBeLessThan(BANNER.width);
      expect(BANNER.minUploadHeight).toBeLessThan(BANNER.height);
    });
  });
});
