import { describe, expect, it } from 'vitest';
import { backplatePrompt, paletteFor, readBrief, specFor, SIGNATURE_MOODS } from './signature-design.js';
import { BANNER_LIMITS, validateBannerSpec } from './forum-signature.js';

/**
 * The generator's whole safety property is that the MODEL never touches a number with a limit.
 *
 * It answers a small closed brief; the code assembles the spec. So the thing worth testing is that
 * a brief which is wrong in every possible way still produces a banner that renders — because the
 * alternative is a member pressing "generate" and getting a black rectangle they cannot explain.
 */

const GOOD = {
  name: 'Gold Rush',
  mood: 'industrial',
  colourA: '#101010',
  colourB: '#d4af37',
  textColour: '#ffffff',
  accentColour: '#d4af37',
  tagline: 'Painite and patience',
  showRank: true,
  imagery: 'a mining ship against a ringed gas giant',
};

describe('readBrief', () => {
  it('takes the prose from the model and the colours from us', () => {
    const b = readBrief(GOOD, 0);
    expect(b.name).toBe('Gold Rush');
    expect(b.mood).toBe('industrial');
    expect(b.tagline).toBe('Painite and patience');
    expect(b.showRank).toBe(true);
  });

  it('MANDATORY: ignores colours the model sent, whatever they are', () => {
    /*
     * The model does not get a vote on colour. Asked for four hex values it produced, for a member
     * who wrote "gold and black", five near-identical greys — twice, through two rounds of
     * prompt rules. Merging its answer with ours is how you get a gold banner with a grey accent.
     */
    const b = readBrief({ ...GOOD, colourA: '#ff00ff', colourB: '#00ff00' }, 0, 'gold');
    expect(b.colourA).not.toBe('#ff00ff');
    expect(b.colourB).not.toBe('#00ff00');
    expect(b.colourB).toBe('#d4af37');
  });

  it('MANDATORY: never throws, whatever the model returned', () => {
    /*
     * Four good options and one malformed one must give the member four options and a plain fifth,
     * not an error page. Every field falls back.
     */
    for (const junk of [null, undefined, 'a string', 42, [], {}, { mood: 'purple' }]) {
      expect(() => readBrief(junk, 0)).not.toThrow();
    }
  });

  it('MANDATORY: nothing the model writes can reach a fill attribute', () => {
    // Colours come from a checked-in table, so an injected string cannot become a CSS value.
    const b = readBrief({ ...GOOD, colourA: 'red; }</style><script>' }, 0);
    expect(b.colourA).toMatch(/^#[0-9a-f]{6}$/);
    expect(b.textColour).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('refuses a mood it does not have a layout for', () => {
    expect(readBrief({ ...GOOD, mood: 'chartreuse' }, 0).mood).toBe('clean');
  });

  it('names an unnamed option by its position', () => {
    expect(readBrief({ ...GOOD, name: '' }, 3).name).toBe('Option 4');
  });

  it('bounds free text the model wrote', () => {
    const b = readBrief({ ...GOOD, tagline: 'x'.repeat(500), imagery: 'y'.repeat(900) }, 0);
    expect(b.tagline.length).toBeLessThanOrEqual(80);
    expect(b.imagery.length).toBeLessThanOrEqual(200);
  });
});

describe('specFor', () => {
  it('MANDATORY: every mood produces a spec the validator accepts', () => {
    /*
     * The point of assembling rather than asking the model for JSON. If this ever fails, a member
     * gets a banner that does not render and nothing tells them why.
     */
    for (const mood of SIGNATURE_MOODS) {
      const spec = specFor(readBrief({ ...GOOD, mood }, 0));
      expect(() => validateBannerSpec(spec)).not.toThrow();
    }
  });

  it('MANDATORY: a spec built from complete junk still validates', () => {
    const spec = specFor(readBrief({ mood: 'nonsense', colourA: 12, tagline: null }, 0));
    expect(() => validateBannerSpec(spec)).not.toThrow();
  });

  it('always puts the commander name first', () => {
    const spec = specFor(readBrief(GOOD, 0));
    expect(spec.layers[0]).toMatchObject({ kind: 'text', source: 'commander', row: 1 });
  });

  it('leaves out the rank line when the brief says so', () => {
    const spec = specFor(readBrief({ ...GOOD, showRank: false }, 0));
    expect(spec.layers.some((l) => l.kind === 'text' && l.source === 'squadronRank')).toBe(false);
  });

  it('leaves out the tagline layer rather than adding an empty one', () => {
    const spec = specFor(readBrief({ ...GOOD, tagline: '' }, 0));
    expect(spec.layers.some((l) => l.kind === 'text' && l.source === 'custom')).toBe(false);
  });

  it('MANDATORY: dims an image backplate and never dims a gradient', () => {
    /*
     * Text over undimmed artwork is the commonest way a generated banner comes out unreadable, and
     * the member cannot see it happening — they are looking at their own name in a colour they
     * picked. A gradient needs no dimming and dimming it just makes it muddy.
     */
    const withImage = specFor(readBrief(GOOD, 0), 'media-123');
    expect(withImage.background).toBe('image');
    expect(withImage.imageMediaId).toBe('media-123');
    expect(withImage.dim).toBeGreaterThan(0);

    const plain = specFor(readBrief(GOOD, 0));
    expect(plain.background).toBe('gradient');
    expect(plain.dim).toBe(0);
    expect(plain.imageMediaId).toBeUndefined();
  });

  it('treats an empty media id as no image', () => {
    // An image background with no image renders as nothing at all.
    expect(specFor(readBrief(GOOD, 0), '').background).toBe('gradient');
  });

  it('keeps the tagline inside the LAYER limit, not the signature one', () => {
    const long = 'z'.repeat(80);
    const spec = specFor(readBrief({ ...GOOD, tagline: long }, 0));
    const custom = spec.layers.find((l) => l.kind === 'text' && l.source === 'custom');
    expect((custom as { text: string }).text.length).toBeLessThanOrEqual(BANNER_LIMITS.maxCustomText);
  });
});

describe('backplatePrompt', () => {
  it('carries the imagery and the composition rule', () => {
    const p = backplatePrompt(readBrief(GOOD, 0));
    expect(p).toContain('ringed gas giant');
    // The left third is where every layout puts the text. Without this the generator centres a
    // ship exactly where the commander name goes.
    expect(p).toContain('left third');
  });

  it('MANDATORY: tells the generator not to draw text', () => {
    /*
     * Image models put invented lettering on anything that looks like a banner. A backplate with
     * gibberish words under the member's real name is the single most obviously broken output this
     * feature can produce.
     */
    const p = backplatePrompt(readBrief(GOOD, 0));
    expect(p).toContain('No text');
    expect(p).toContain('no watermark');
  });
});


describe('paletteFor', () => {
  it('MANDATORY: honours a colour the member named, on every option', () => {
    /*
     * Asking for gold and getting one gold option out of five is not honouring the request. The
     * variety comes from the mood layouts and the two entries per family, not from ignoring them.
     */
    for (let i = 0; i < 5; i += 1) {
      const p = paletteFor('black and gold please', SIGNATURE_MOODS[i] ?? 'clean', i);
      expect(['#d4af37', '#8a6d1f']).toContain(p.colourB);
    }
  });

  it('reads the colour out of a whole sentence', () => {
    expect(paletteFor('I like teal a lot', 'clean', 0).colourB).toBe('#00c8ff');
    expect(paletteFor('something crimson', 'clean', 0).colourB).toBe('#c0271f');
    expect(paletteFor('gunmetal, nothing flashy', 'clean', 0).colourB).toBe('#4b5563');
  });

  it('takes the FIRST colour named, because that is what they meant', () => {
    // "gold with a bit of blue" means gold.
    expect(paletteFor('gold with a bit of blue', 'clean', 0).colourB).toBe('#d4af37');
  });

  it('gives each mood a different family when no colour was named', () => {
    // Five obviously different banners, rather than five shades of one.
    const families = SIGNATURE_MOODS.map((m) => paletteFor('', m, 0).colourB);
    expect(new Set(families).size).toBe(SIGNATURE_MOODS.length);
  });

  it('MANDATORY: every palette is dark behind light text', () => {
    /*
     * The background carries the commander's name. A light `colourA` makes it unreadable, and the
     * member cannot see it happening because they are looking at their own name.
     */
    const luminance = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
    };
    for (const word of ['gold', 'orange', 'cyan', 'red', 'green', 'purple', 'ice', 'steel', '']) {
      for (const mood of SIGNATURE_MOODS) {
        for (const i of [0, 1]) {
          const p = paletteFor(word, mood, i);
          expect(luminance(p.colourA), `${word}/${mood}/${i} background`).toBeLessThan(0.2);
          expect(luminance(p.textColour), `${word}/${mood}/${i} text`).toBeGreaterThan(0.75);
        }
      }
    }
  });
});
