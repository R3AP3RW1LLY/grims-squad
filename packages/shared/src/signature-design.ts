import {
  BANNER_LIMITS,
  type BannerSpec,
  type BannerTextLayer,
} from './forum-signature.js';

/**
 * Turning "make me something for a miner who likes gold" into a banner.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "option 1 is generate signature with GMSD AI which should be a prompt based and Q&A based
 * signature generator ... should give the user 5 options to choose from"
 *
 * ★ THE MODEL DESIGNS. IT DOES NOT EMIT THE SPEC. ★
 *
 * The obvious build asks the model for a `BannerSpec` as JSON. It is the wrong one, and not
 * marginally:
 *
 *   - The spec has eighteen-layer limits, per-layer fonts, clamped sizes, hex colours and a
 *     discriminated union. A 7B model will produce something SHAPED like that and wrong in one
 *     field, and one wrong field is a banner that renders as a black rectangle.
 *   - Every failure is a retry, and retries on a local GPU are the whole latency budget.
 *   - Nothing about the output is reviewable. A palette is; a hundred lines of JSON is not.
 *
 * So the model answers a small, closed brief — a mood, five hex colours, a tagline, which facts to
 * show — and the code below assembles a spec that is valid BY CONSTRUCTION. The model never touches
 * a number that has a limit, never names a layer kind, and cannot produce a banner that fails to
 * render.
 *
 * What the member sees is unaffected: five distinct designs, from their own words.
 */

/** The looks the generator can produce. Named, because a mood is a layout decision, not a colour. */
export const SIGNATURE_MOODS = ['clean', 'industrial', 'neon', 'military', 'minimal'] as const;
export type SignatureMood = (typeof SIGNATURE_MOODS)[number];

/**
 * What the model is asked for, per option.
 *
 * Deliberately small. Every field here is either free text with a length cap or a value validated
 * against a list — there is nothing a wrong answer can break.
 */
export interface DesignBrief {
  /** One or two words naming the direction, shown on the option card. */
  readonly name: string;
  readonly mood: SignatureMood;
  /** Background, darkest first. `#rrggbb`. */
  readonly colourA: string;
  readonly colourB: string;
  /** The commander's name and any ranks. `#rrggbb`. */
  readonly textColour: string;
  /** Used for the tagline and labels — the one colour that should carry. `#rrggbb`. */
  readonly accentColour: string;
  /** Their own words, or the model's, up to the signature limit. Empty for none. */
  readonly tagline: string;
  /** Whether to show the squadron rank line. */
  readonly showRank: boolean;
  /**
   * A scene for the backplate, in the model's words. Empty when this option is a plain gradient.
   *
   * Kept as PROSE rather than a filename or a style id: it is fed to the image generator, which
   * takes a prompt. See `backplatePrompt`.
   */
  readonly imagery: string;
}

/*
 * There is deliberately no hex validator here any more.
 *
 * There was one, because the model supplied colours and a non-hex string reaches an SVG `fill`
 * attribute. The model no longer supplies any — every colour comes from `PALETTES` below, which is
 * a checked-in table. Keeping a validator for input that cannot arrive is a function that looks
 * load-bearing and is not.
 */

function text(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * Reads one brief out of whatever the model returned.
 *
 * ★ NEVER THROWS ★
 *
 * A model that returns four good options and one malformed one should give the member four
 * options, not an error. Everything here has a fallback, and the fallbacks are the squadron
 * palette — so the worst case is a plain design rather than a missing one.
 */
export function readBrief(raw: unknown, index: number, wanted = ''): DesignBrief {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const mood = SIGNATURE_MOODS.includes(o['mood'] as SignatureMood)
    ? (o['mood'] as SignatureMood)
    : 'clean';

  /*
   * ★ THE PALETTE IS OURS TOO, AND THAT WAS NOT THE FIRST PLAN — 2026-08-01 ★
   *
   * The model was asked for four hex colours. Against the real one it produced, for a member who
   * asked in as many words for "gold and black", five near-identical dark greys — and colourA and
   * colourB within a few percent of each other, so every gradient rendered as a flat rectangle.
   *
   * Two rounds of prompt rules did not move it. Adding "if they named colours, USE those colours"
   * and "colourB must be OBVIOUSLY different" changed nothing measurable: still grey, still no
   * gold. A 7B follows instructions about prose and does not follow instructions about hex.
   *
   * So colour joins layout on the code's side of the line. `paletteFor` picks from a curated set
   * that is readable by construction and on-brand by construction, keyed on what the member
   * actually asked for. The model keeps what it is genuinely good at — the name, the tagline and
   * the imagery, all of which came back specific and varied from the first attempt.
   *
   * Anything the model does send is ignored rather than merged: a palette half-chosen by each is
   * how you get a gold banner with a grey accent.
   */
  const palette = paletteFor(wanted, mood, index);

  return {
    name: text(o['name'], 24) || `Option ${index + 1}`,
    mood,
    ...palette,
    tagline: text(o['tagline'], 80),
    showRank: o['showRank'] !== false,
    imagery: text(o['imagery'], 200),
  };
}

/** A readable, on-brand set of four colours. */
interface Palette {
  readonly colourA: string;
  readonly colourB: string;
  readonly textColour: string;
  readonly accentColour: string;
}

/**
 * The palettes, by family.
 *
 * ★ EVERY ONE IS DARK-TO-COLOUR, NEVER DARK-TO-DARK ★
 *
 * The background carries the commander's name, so `colourA` is always near-black and `textColour`
 * is always near-white — that pairing is what makes the banner readable regardless of which family
 * gets chosen. The character comes from `colourB` and the accent, which is where a gradient is
 * actually visible.
 */
const PALETTES: Record<string, readonly Palette[]> = {
  gold: [
    { colourA: '#0a0805', colourB: '#d4af37', textColour: '#f5efe0', accentColour: '#ffd76a' },
    { colourA: '#100c04', colourB: '#8a6d1f', textColour: '#f0e8d5', accentColour: '#e0b64a' },
  ],
  orange: [
    { colourA: '#05070a', colourB: '#ff7100', textColour: '#e8eef5', accentColour: '#ff9d3f' },
    { colourA: '#0b0704', colourB: '#b34f00', textColour: '#f2e6dc', accentColour: '#ff7100' },
  ],
  cyan: [
    { colourA: '#03080c', colourB: '#00c8ff', textColour: '#e8f6ff', accentColour: '#5cd9ff' },
    { colourA: '#05101a', colourB: '#0e7490', textColour: '#dff2fb', accentColour: '#22d3ee' },
  ],
  red: [
    { colourA: '#0a0303', colourB: '#c0271f', textColour: '#f7e7e5', accentColour: '#ff7a7a' },
    { colourA: '#12060a', colourB: '#7f1d3a', textColour: '#fbe4ec', accentColour: '#f472a0' },
  ],
  green: [
    { colourA: '#030a06', colourB: '#1f9d55', textColour: '#e4f8ec', accentColour: '#3dff8f' },
    { colourA: '#06110c', colourB: '#0f766e', textColour: '#dcf5f0', accentColour: '#2dd4bf' },
  ],
  purple: [
    { colourA: '#07040d', colourB: '#7c3aed', textColour: '#efe7ff', accentColour: '#c4b5fd' },
    { colourA: '#0d0616', colourB: '#a21caf', textColour: '#fbe8fb', accentColour: '#e879f9' },
  ],
  ice: [
    { colourA: '#04070b', colourB: '#7dd3fc', textColour: '#eef8ff', accentColour: '#bae6fd' },
    { colourA: '#080d14', colourB: '#94a3b8', textColour: '#f1f5f9', accentColour: '#cbd5e1' },
  ],
  steel: [
    { colourA: '#070a0d', colourB: '#4b5563', textColour: '#e8eef5', accentColour: '#93a4b8' },
    { colourA: '#0b0f14', colourB: '#334155', textColour: '#e2e8f0', accentColour: '#94a3b8' },
  ],
};

/**
 * Words that pick a family.
 *
 * Matched against what the member typed, so "black and gold", "goldish" and "I like gold" all land
 * on the same palette. Order matters only in that the first hit wins — which is right, because
 * somebody who writes "gold with a bit of blue" means gold.
 */
const COLOUR_WORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['gold', ['gold', 'amber', 'brass', 'bronze', 'yellow']],
  ['orange', ['orange', 'squadron', 'rust', 'copper', 'fire']],
  ['cyan', ['cyan', 'blue', 'teal', 'azure', 'aqua']],
  ['red', ['red', 'crimson', 'blood', 'scarlet', 'maroon', 'pink']],
  ['green', ['green', 'emerald', 'jade', 'lime', 'toxic']],
  ['purple', ['purple', 'violet', 'magenta', 'indigo']],
  ['ice', ['ice', 'white', 'frost', 'silver', 'pale', 'arctic']],
  ['steel', ['steel', 'grey', 'gray', 'slate', 'iron', 'gunmetal', 'industrial']],
];

/** Which family a mood falls back to when the member named no colour at all. */
const MOOD_DEFAULT: Record<SignatureMood, string> = {
  clean: 'cyan',
  industrial: 'orange',
  neon: 'purple',
  military: 'green',
  minimal: 'steel',
};

/**
 * Picks a palette from what the member asked for.
 *
 * ★ HONOURS THE REQUEST, THEN VARIES ★
 *
 * If they named a colour, every option uses that family — asking for gold and getting one gold
 * option out of five is not honouring the request. Variety then comes from the two entries in the
 * family and from the mood's own layout, which differ enough to be five distinct designs.
 *
 * If they named nothing, each mood takes its own family, which gives five obviously different
 * banners rather than five shades of the same one.
 */
export function paletteFor(wanted: string, mood: SignatureMood, index: number): Palette {
  const said = wanted.toLowerCase();
  const named = COLOUR_WORDS.find(([, words]) => words.some((w) => said.includes(w)));
  const family = named?.[0] ?? MOOD_DEFAULT[mood];
  /*
   * `orange` is the squadron colour and is the fallback for a family that somehow is not in the
   * table. Asserted rather than optional-chained: an empty PALETTES entry is a programming error
   * that should be loud in a test, not a silently colourless banner in production.
   */
  const set = PALETTES[family] ?? (PALETTES['orange'] as readonly Palette[]);
  return set[index % set.length] as Palette;
}

/**
 * How each mood lays itself out.
 *
 * ★ THE LAYOUT IS OURS, NOT THE MODEL'S ★
 *
 * Sizes, rows and alignment are design decisions with correct answers — a 44pt commander name over
 * a 40pt tagline is unreadable at any colour. Fixing them here means the model chooses the FEEL and
 * cannot choose a broken composition, and it means a new mood is a table entry rather than a prompt
 * rewrite.
 */
const MOODS: Record<
  SignatureMood,
  {
    readonly nameSize: number;
    readonly taglineSize: number;
    readonly mono: boolean;
    readonly bold: boolean;
    readonly angle: number;
    readonly spread: number;
    readonly radius: number;
    /** How hard to dim an image backplate so text stays readable on it. */
    readonly dim: number;
  }
> = {
  clean: { nameSize: 28, taglineSize: 13, mono: false, bold: true, angle: 0, spread: 100, radius: 12, dim: 45 },
  industrial: { nameSize: 26, taglineSize: 12, mono: true, bold: true, angle: 90, spread: 70, radius: 4, dim: 55 },
  neon: { nameSize: 30, taglineSize: 13, mono: false, bold: true, angle: 45, spread: 60, radius: 16, dim: 50 },
  military: { nameSize: 24, taglineSize: 12, mono: true, bold: true, angle: 0, spread: 40, radius: 0, dim: 60 },
  minimal: { nameSize: 22, taglineSize: 12, mono: false, bold: false, angle: 0, spread: 100, radius: 8, dim: 35 },
};

/**
 * Builds a renderable banner from a brief.
 *
 * Every number comes from the mood table or is clamped here, so the result satisfies
 * `validateBannerSpec` without being passed through it — which matters because this runs per
 * option and a rejected spec at this stage has nothing to fall back to.
 */
export function specFor(brief: DesignBrief, imageMediaId?: string): BannerSpec {
  const m = MOODS[brief.mood];
  const hasImage = imageMediaId !== undefined && imageMediaId !== '';

  const layers: BannerTextLayer[] = [
    {
      kind: 'text',
      source: 'commander',
      row: 1,
      align: 'left',
      size: clamp(m.nameSize, BANNER_LIMITS.minTextSize, BANNER_LIMITS.maxTextSize),
      bold: m.bold,
      colour: brief.textColour,
      mono: m.mono,
    },
  ];

  if (brief.showRank) {
    layers.push({
      kind: 'text',
      source: 'squadronRank',
      row: 2,
      align: 'left',
      size: clamp(m.taglineSize + 1, BANNER_LIMITS.minTextSize, BANNER_LIMITS.maxTextSize),
      bold: false,
      colour: brief.accentColour,
      mono: true,
    });
  }

  if (brief.tagline !== '') {
    layers.push({
      kind: 'text',
      source: 'custom',
      // Trimmed to the layer limit, which is shorter than the tagline field on the signature
      // itself — a banner line and a signature tagline are different things with different room.
      text: brief.tagline.slice(0, BANNER_LIMITS.maxCustomText),
      row: 3,
      align: 'left',
      size: clamp(m.taglineSize, BANNER_LIMITS.minTextSize, BANNER_LIMITS.maxTextSize),
      bold: false,
      colour: brief.accentColour,
      mono: m.mono,
    });
  }

  return {
    version: 2,
    background: hasImage ? 'image' : 'gradient',
    colourA: brief.colourA,
    colourB: brief.colourB,
    /*
     * An image backplate is dimmed; a gradient is not. Text over undimmed artwork is the single
     * commonest way a generated banner comes out unreadable, and the member cannot see it happening
     * because they are looking at their own name in a colour they chose.
     */
    dim: hasImage ? clamp(m.dim, 0, BANNER_LIMITS.maxDim) : 0,
    angle: m.angle,
    spread: clamp(m.spread, BANNER_LIMITS.minSpread, BANNER_LIMITS.maxSpread),
    radius: clamp(m.radius, 0, BANNER_LIMITS.maxRadius),
    ...(hasImage ? { imageMediaId } : {}),
    layers,
  };
}

/**
 * The prompt sent to the image generator for a backplate.
 *
 * ★ IT DESCRIBES A BACKGROUND, NOT A PICTURE ★
 *
 * The member's words describe what they like; a banner backplate has to survive having a name
 * written across it. So the scene is pushed wide and dark, and told to leave the left side quiet —
 * which is where every layout above puts the text.
 */
export function backplatePrompt(brief: DesignBrief, wanted = ''): string {
  /*
   * ★ THE MEMBER'S OWN WORDS COME FIRST — squadron owner, 2026-08-01 ★
   *
   * "it must also generate actual images for background if they want for example like a galaxy,
   * planet surface or something else they may prompt ... wildly unique to what the end user wants".
   *
   * The model is asked for a scene and does it well — against the real one it returned a Krait over
   * an asteroid field for somebody who said they mine. But "does it well" is not "always", and a
   * member who typed "a planet surface at dawn" and got a nebula would reasonably conclude nothing
   * read what they wrote.
   *
   * So when they described a background, that description leads and the model's is the variation
   * behind it. Five options still differ, because the model's sentence differs each time.
   */
  const asked = wanted.trim();
  const scene = asked === '' ? brief.imagery : `${asked}. ${brief.imagery}`;

  return [
    `Elite Dangerous style space scene: ${scene}.`,
    'Wide cinematic banner background, dark, high contrast, deep shadows.',
    // The composition instruction is what makes it usable rather than merely pretty.
    'Empty uncluttered space on the left third for text overlay.',
    'No text, no letters, no words, no logos, no watermark, no user interface.',
  ].join(' ');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
