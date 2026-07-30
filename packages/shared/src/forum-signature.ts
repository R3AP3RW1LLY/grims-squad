import { FONT_SITE_DEFAULT, isKnownFont } from './fonts.js';

/**
 * Forum signatures (P2 — the block under a member's posts).
 *
 * ★ WHAT THE OWNER ASKED FOR ★
 *
 * Squadron owner, 2026-07-30: "we also need an epic forum signature generator, make this an
 * awesome generator please make it feature ritch include the users avatar from discord as the
 * default, but allow users to upload a signature avatar if they want to customize it, also allow
 * them to make a custom banner to go on their signature that links to inara commander profile or
 * something of that nature or a stream channel if they are a streamer etc, make this fully
 * customizable ... the avatar upload should only be displayed on the forums and not replace their
 * global avatar that discord imports."
 *
 * ★ WHY THIS FILE EXISTS RATHER THAN VALIDATION SPRINKLED ACROSS THE API ★
 *
 * A signature is member-authored content rendered under EVERY post they have ever written. That is
 * the largest reach any single field on this site has: one bad value is not one bad page, it is a
 * hundred. So every limit is stated once, here, and both the editor and the server read it — an
 * editor that permits what the server refuses teaches members the site is broken, and an editor
 * stricter than the server hides a hole rather than closing it.
 */

/** Characters in the one-line tagline. Two sentences, not a paragraph. */
export const SIGNATURE_TAGLINE_MAX = 120;

/** Characters in the banner's link text. It is a label, not a second tagline. */
export const SIGNATURE_LABEL_MAX = 60;

/**
 * The accents a signature may use.
 *
 * ★ A CLOSED SET, AND WHY IT IS NOT A COLOUR PICKER ★
 *
 * "Fully customizable" was the instruction, and a free colour field is the naive reading of it.
 * It is also how a member ends up with near-black text on our near-black panel — not maliciously,
 * just by picking a colour that looked fine in the picker. Every one of those is a support message
 * from somebody who cannot read their own signature.
 *
 * These are the site's own accents, so every combination is legible against every surface we
 * render, in both the light and dark treatments, without anybody having to check.
 */
export const SIGNATURE_ACCENTS = ['orange', 'cyan', 'gold', 'steel'] as const;
export type SignatureAccent = (typeof SIGNATURE_ACCENTS)[number];

/**
 * Hosts a signature banner may link to.
 *
 * ★ AN ALLOWLIST, BECAUSE A SIGNATURE IS ADVERTISING SPACE ★
 *
 * The owner named the destinations: "inara commander profile or something of that nature or a
 * stream channel if they are a streamer". That is a short list, and writing it down costs nothing.
 *
 * An arbitrary URL is a different feature. A link under every post a member has written is a
 * hundred impressions a day on a site of 107 people, and the first time one points somewhere
 * unpleasant it is a moderation problem on every page that member has ever posted on — retroactive,
 * and not fixable by deleting one post.
 *
 * ★ SUBDOMAINS COUNT, ARBITRARY PREFIXES DO NOT ★
 *
 * `inara.cz` matches `inara.cz` and `www.inara.cz`. It does NOT match `inara.cz.evil.test`, which
 * is the entire reason this is a suffix check anchored on a dot rather than `includes()`.
 */
export const SIGNATURE_LINK_HOSTS = [
  'inara.cz',
  'twitch.tv',
  'youtube.com',
  'youtu.be',
  'kick.com',
  'edsm.net',
  'elitedangerous.com',
] as const;

/**
 * Whether a URL is one a signature may point at.
 *
 * HTTPS only. A plaintext link from a page served over TLS is a downgrade the reader did not
 * choose, and every host on the list above supports HTTPS.
 */
export function isAllowedSignatureLink(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  /*
   * Credentials in a URL (`https://user:pass@host/`) are refused outright. They are a classic way
   * to make a link LOOK like it points at an allowed host — the part before the `@` is what a
   * reader's eye lands on, and everything before it is ignored by the browser.
   */
  if (url.username !== '' || url.password !== '') return false;

  const host = url.hostname.toLowerCase();
  return SIGNATURE_LINK_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** A signature as the API accepts it. Every field optional: saving one control saves one field. */
export interface SignatureInput {
  readonly avatarMediaId?: string | null;
  /** The generated banner, when they built one rather than uploading a finished image. */
  readonly bannerSpec?: unknown;
  /**
   * A flat PNG of the banner, rasterised by the browser and stored, for sharing off-site.
   *
   * Separate from `bannerMediaId` on purpose: that is a banner they UPLOADED, this is a snapshot of
   * one they BUILT. Conflating them would mean publishing a built banner silently replaced their
   * uploaded one, and un-publishing would take it with it.
   */
  readonly bannerPublishedMediaId?: string | null;
  readonly tagline?: string | null;
  readonly bannerMediaId?: string | null;
  readonly bannerUrl?: string | null;
  readonly bannerLabel?: string | null;
  readonly accent?: SignatureAccent;
  readonly showRank?: boolean;
  readonly showCommander?: boolean;
  readonly enabled?: boolean;
}

/** A signature as it is rendered. Paths only — never a third-party address. */
export interface SignatureView {
  readonly avatarUrl: string | null;
  /** Null when they uploaded a finished image instead of building one. */
  readonly bannerSpec: BannerSpec | null;
  /**
   * ABSOLUTE url of the published snapshot, or null.
   *
   * Absolute because it is meant to leave this site — a relative path is meaningless the moment it
   * is pasted anywhere else.
   */
  readonly publishedBannerUrl: string | null;
  readonly tagline: string | null;
  readonly bannerUrl: string | null;
  readonly bannerLink: string | null;
  readonly bannerLabel: string | null;
  readonly accent: SignatureAccent;
  readonly showRank: boolean;
  readonly showCommander: boolean;
  readonly enabled: boolean;
}

/* ------------------------------------------------------------ the banner */

/**
 * The banner: 600 × 160, three lines.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "the signature banner needs to have multiple lines, and must allow poeple to add way more content
 * etc to them including their ingame ranks, experience, anything they want too really that we
 * collect from them ... the signature must be 3 lines ... make this wildly configuable".
 *
 * ★ WHY THREE ROWS AND NOT FREE POSITIONING ★
 *
 * The first version used nine anchor points, which gave three lines by accident and let two layers
 * land on top of each other. Rows make it explicit: every layer belongs to line 1, 2 or 3, and
 * layers sharing a line sit side by side rather than overlapping.
 *
 * That is also what makes "way more content" survivable. A banner listing six Elite ranks is a
 * banner where the text is not fixed — "Elite V" and "Harmless" are different widths, and a layout
 * tuned against one breaks against the other. Rows reflow; absolute coordinates do not.
 *
 * The height went from 120 to 160 for the same reason: three lines of readable text plus breathing
 * room does not fit in 120, and cramming it produced banners nobody could read at a glance.
 */
export const BANNER = {
  width: 600,
  height: 160,
  /** Three lines, as asked. Named rather than assumed so the renderer and the editor agree. */
  rows: 3,
  /**
   * The smallest upload worth accepting as a background.
   *
   * Below this, scaling up produces a blurred mess and the member blames us rather than their
   * source file. Refused with both numbers stated, which is the only refusal anybody can act on.
   */
  minUploadWidth: 300,
  minUploadHeight: 80,
} as const;

/** Backgrounds the generator can build without anybody uploading anything. */
export const BANNER_BACKGROUNDS = ['solid', 'gradient', 'starfield', 'image'] as const;
export type BannerBackground = (typeof BANNER_BACKGROUNDS)[number];

/** Which of the three lines a layer sits on. */
export const BANNER_ROWS = [1, 2, 3] as const;
export type BannerRow = (typeof BANNER_ROWS)[number];

/** Where on its line a layer sits. Layers sharing a row and an alignment flow left to right. */
export const BANNER_ALIGNS = ['left', 'center', 'right'] as const;
export type BannerAlign = (typeof BANNER_ALIGNS)[number];

/**
 * Everything a text layer can say.
 *
 * ★ SOURCES, NOT BAKED STRINGS ★
 *
 * Every one of these except `custom` is looked up when the banner is DRAWN. That is what lets
 * somebody put their Combat rank on a banner and have it read "Deadly" the week after it read
 * "Dangerous", without knowing they were supposed to come back and edit it.
 *
 * The list is deliberately everything we actually hold. "Anything they want, really, that we
 * collect from them" was the instruction, and a source that resolves to nothing renders as nothing
 * rather than as an empty box — so offering all of them costs nothing to somebody who has not
 * verified their commander yet.
 */
export const BANNER_TEXT_SOURCES = [
  'commander',
  'squadronRank',
  'squadron',
  'allegiance',
  'combat',
  'trade',
  'explore',
  'soldier',
  'exobiologist',
  'cqc',
  'ship',
  'memberSince',
  'lastPlayed',
  'custom',
] as const;
export type BannerTextSource = (typeof BANNER_TEXT_SOURCES)[number];

/** Human labels for the editor, and the prefix a layer can show before its value. */
export const BANNER_SOURCE_LABELS: Record<BannerTextSource, string> = {
  commander: 'CMDR name',
  squadronRank: 'Squadron rank',
  squadron: 'Squadron',
  allegiance: 'Allegiance',
  combat: 'Combat',
  trade: 'Trade',
  explore: 'Exploration',
  soldier: 'Mercenary',
  exobiologist: 'Exobiology',
  cqc: 'CQC',
  ship: 'Current ship',
  memberSince: 'Member since',
  lastPlayed: 'Last played',
  custom: 'My own words',
};

/** Badges we hold ourselves. Never an arbitrary image — see `BannerBadgeLayer`. */
export const BANNER_BADGES = ['squadron', 'rank'] as const;
export type BannerBadge = (typeof BANNER_BADGES)[number];

/**
 * A colour on a banner.
 *
 * ★ FREE HEX, AS ASKED ★
 *
 * Squadron owner, 2026-07-30: "the colors should allow color pickers with hex code input etc, make
 * this wildly configuable". The earlier closed palette was chosen so nobody could pick text that
 * was illegible against their own background; that concern was raised and overruled, so this takes
 * any `#rrggbb`.
 *
 * Two things keep the failure mode small rather than arguing with the decision. The renderer draws
 * every text layer with a dark outline, so light text stays readable over a light background; and
 * the editor keeps the squadron palette as one-click presets, so the easy path is still on-brand.
 */
export const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

/** The squadron palette, offered as presets rather than as the only choice. */
export const BANNER_PALETTE = [
  '#ff7100',
  '#ff9d3f',
  '#5cd9ff',
  '#00c8ff',
  '#3dff8f',
  '#ffc400',
  '#e8eef5',
  '#93a4b8',
  '#0b0f14',
] as const;

export interface BannerTextLayer {
  readonly kind: 'text';
  readonly source: BannerTextSource;
  /** Only used when `source` is `custom`. Plain text, escaped at render. */
  readonly text?: string;
  /**
   * A word before the value, e.g. `COMBAT` before `Deadly`.
   *
   * Optional because a banner that labels everything reads like a form. Somebody putting one rank
   * on line three wants "Deadly"; somebody putting three wants them told apart.
   */
  readonly label?: string;
  readonly row: BannerRow;
  readonly align: BannerAlign;
  readonly size: number;
  readonly bold: boolean;
  /** `#rrggbb`. */
  readonly colour: string;
  /** Monospace with wide tracking: the console look the rest of the site uses for labels. */
  readonly mono: boolean;
  /**
   * A font from the catalogue, PER LAYER.
   *
   * Squadron owner, 2026-07-30: "in posts and banners they should be able to use multiple fonts if
   * they want too". So this is on the layer rather than on the banner — a name in Orbitron above a
   * rank list in Share Tech Mono is the normal case, not an edge one.
   *
   * An ID, never a CSS value. A stored font stack would be member-authored text reaching a `style`
   * attribute, and a font stack is one of the few CSS values that happily accepts anything.
   * Omitted means the layer follows `mono` and the site face, which is what every existing banner
   * does.
   */
  readonly font?: string;
}

export interface BannerBadgeLayer {
  readonly kind: 'badge';
  /**
   * Their OWN badge image, instead of the squadron mark.
   *
   * Squadron owner, 2026-07-30: "the ability to add their own badge instead of the default".
   *
   * OUR media id, so the same rule as the background holds — there is no field in which a foreign
   * host could be written. Absent means the named `badge` below is used.
   */
  readonly mediaId?: string;
  /**
   * ★ A NAMED BADGE, NOT AN IMAGE ID ★
   *
   * The squadron mark and rank insignia are OURS. Letting this carry an arbitrary media id would
   * make a banner able to composite any uploaded image anywhere — a second image pipeline with
   * none of the fitting rules the background has.
   */
  readonly badge: BannerBadge;
  readonly row: BannerRow;
  readonly align: BannerAlign;
  readonly size: number;
}

export type BannerLayer = BannerTextLayer | BannerBadgeLayer;

export interface BannerSpec {
  readonly version: 2;
  readonly background: BannerBackground;
  /** `#rrggbb`. Used by `solid` and, with `colourB`, by `gradient`. */
  readonly colourA: string;
  readonly colourB: string;
  /**
   * For `image`: OUR media id, already hardened on upload.
   *
   * There is no URL field, for the same reason the rich document has none — a banner cannot
   * reference a third-party host because there is nowhere to write one.
   */
  readonly imageMediaId?: string;
  /** How much to dim the background so text stays readable on top of it. Percent. */
  readonly dim: number;
  /**
   * Extra gradient stops, between `colourA` and `colourB`.
   *
   * Owner: "ability to add more colors to the gradient". Kept separate from the two ends rather
   * than replacing them with an array, so every banner ever saved still reads correctly — a
   * two-colour gradient is the same thing with no middle stops.
   */
  readonly stops?: readonly string[];
  /**
   * Gradient angle in degrees. 0 is left-to-right.
   *
   * Owner: "ability to widen or narrow the gradient" — which is really two controls. This one
   * turns it; `spread` below tightens it.
   */
  readonly angle?: number;
  /**
   * How much of the banner the transition occupies, as a percentage.
   *
   * 100 spreads it edge to edge; 20 makes a narrow band with flat colour either side. This is what
   * "widen or narrow" asks for, and it is the difference between a wash and a deliberate stripe.
   */
  readonly spread?: number;
  /** Corner radius in pixels. Owner asked for rounded corners; 0 keeps the old square banner. */
  readonly radius?: number;
  readonly layers: readonly BannerLayer[];
}

/** Hard limits. Generous, because "wildly configurable" was the instruction. */
export const BANNER_LIMITS = {
  /** Enough for three well-populated lines plus a badge, and short of a banner nobody can read. */
  maxLayers: 18,
  minTextSize: 8,
  maxTextSize: 44,
  minBadgeSize: 16,
  maxBadgeSize: 140,
  maxCustomText: 64,
  maxLabel: 16,
  maxDim: 85,
  /** Middle gradient stops. Four plus the two ends is already more colours than a banner needs. */
  maxStops: 4,
  maxRadius: 40,
  minSpread: 10,
  maxSpread: 100,
} as const;

/**
 * Validates a banner spec that arrived from a browser.
 *
 * ★ CLAMPS NUMBERS, REFUSES STRUCTURE, DROPS THE UNKNOWN ★
 *
 * A size outside the range is a slider bug or an older client, not an attack, so it is clamped —
 * losing somebody's whole banner over one number would be a bad trade. A background nobody defined
 * has no sensible substitute, so it is refused. A colour that is not a hex value falls back rather
 * than reaching the renderer, where an arbitrary string would become a CSS value nobody validated.
 */
export function validateBannerSpec(raw: unknown): BannerSpec {
  const fail = (why: string): never => {
    throw new Error(why);
  };
  const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
    const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
    return Math.min(hi, Math.max(lo, Math.round(v)));
  };
  const hex = (v: unknown, fallback: string): string =>
    typeof v === 'string' && HEX_COLOUR.test(v) ? v.toLowerCase() : fallback;

  /*
   * A direct `throw`, not `fail(...)`. TypeScript only narrows after a never-returning call when
   * the callee is a function DECLARATION — a `const fail = (): never =>` does not narrow, so every
   * later property access would be an error on a possibly-null value.
   */
  if (raw === null || typeof raw !== 'object') {
    throw new Error('That banner is not in a shape we recognise.');
  }
  /*
   * ★ VERSION 1 IS MIGRATED, NOT REFUSED ★
   *
   * Version 1 banners were 600 × 120 with nine anchor points and palette-name colours. Refusing
   * them would blank the banner of everybody who built one before this change — so they are read,
   * their anchors become rows, and their palette names become hex.
   *
   * Read off the RAW record rather than the narrowed one: `Partial<BannerSpec>` types `version` as
   * `2 | undefined`, so comparing it to 1 is a compile error on a value that genuinely occurs.
   */
  const version = (raw as Record<string, unknown>)['version'];
  if (version === 1) return migrateV1(raw as Record<string, unknown>);

  const o = raw as Partial<BannerSpec>;
  if (version !== 2) fail('That banner was made by a different version of the editor.');

  const background = o.background ?? 'gradient';
  if (!(BANNER_BACKGROUNDS as readonly string[]).includes(background)) {
    fail('That is not one of our backgrounds.');
  }

  const rawLayers = Array.isArray(o.layers) ? o.layers : [];
  if (rawLayers.length > BANNER_LIMITS.maxLayers) {
    fail(`A banner can hold ${BANNER_LIMITS.maxLayers} layers.`);
  }

  const layers: BannerLayer[] = rawLayers.map((l): BannerLayer => {
    /*
     * A record of unknowns rather than `Partial<Text & Badge>`. That intersection collapses `kind`
     * to `'text' & 'badge'`, which is `never` — every field access after narrowing became an error
     * on a value TypeScript believed could not exist. This is also the honest description: nothing
     * is known about untrusted input until it is checked.
     */
    const layer = l as Record<string, unknown>;

    const row = (BANNER_ROWS as readonly number[]).includes(layer['row'] as number)
      ? (layer['row'] as BannerRow)
      : 2;
    const align = (BANNER_ALIGNS as readonly string[]).includes(layer['align'] as string)
      ? (layer['align'] as BannerAlign)
      : 'left';

    if (layer['kind'] === 'badge') {
      if (!(BANNER_BADGES as readonly string[]).includes(layer['badge'] as string)) {
        fail('That is not one of our badges.');
      }
      return {
        kind: 'badge',
        badge: layer['badge'] as BannerBadge,
        ...(typeof layer['mediaId'] === 'string' && layer['mediaId'] !== ''
          ? { mediaId: layer['mediaId'] }
          : {}),
        row,
        align,
        size: clamp(layer['size'], BANNER_LIMITS.minBadgeSize, BANNER_LIMITS.maxBadgeSize, 48),
      };
    }

    if (layer['kind'] !== 'text') fail('That is not one of our layer types.');

    const source = (BANNER_TEXT_SOURCES as readonly string[]).includes(layer['source'] as string)
      ? (layer['source'] as BannerTextSource)
      : 'custom';

    const text =
      typeof layer['text'] === 'string'
        ? layer['text'].trim().slice(0, BANNER_LIMITS.maxCustomText)
        : '';
    const label =
      typeof layer['label'] === 'string'
        ? layer['label'].trim().slice(0, BANNER_LIMITS.maxLabel)
        : '';

    return {
      kind: 'text',
      source,
      /*
       * Stored text is kept ONLY for `custom`. A `combat` layer that also carried text would leave
       * an old rank sitting in the spec after a promotion, and whichever the renderer happened to
       * prefer would decide whether the banner was right — not a decision worth having.
       */
      ...(source === 'custom' ? { text } : {}),
      ...(label === '' ? {} : { label }),
      row,
      align,
      size: clamp(layer['size'], BANNER_LIMITS.minTextSize, BANNER_LIMITS.maxTextSize, 18),
      bold: layer['bold'] === true,
      colour: hex(layer['colour'], '#e8eef5'),
      mono: layer['mono'] === true,
      /*
       * Checked against the catalogue, so an id we do not serve is DROPPED rather than stored. An
       * unknown id would resolve to `inherit` at render time anyway, but storing it would leave a
       * banner quietly referencing a font that never existed.
       */
      ...(typeof layer['font'] === 'string' && isKnownFont(layer['font']) && layer['font'] !== FONT_SITE_DEFAULT
        ? { font: layer['font'] }
        : {}),
    };
  });

  return {
    version: 2,
    background: background as BannerBackground,
    colourA: hex(o.colourA, '#0b0f14'),
    colourB: hex(o.colourB, '#ff7100'),
    ...(typeof o.imageMediaId === 'string' && o.imageMediaId !== ''
      ? { imageMediaId: o.imageMediaId }
      : {}),
    dim: clamp(o.dim, 0, BANNER_LIMITS.maxDim, 0),
    /*
     * Every stop hex-checked and the list capped. An unparseable colour is DROPPED rather than
     * defaulted — a stop nobody chose appearing in the middle of a gradient is more confusing than
     * one that simply is not there.
     */
    ...(Array.isArray(o.stops)
      ? {
          stops: o.stops
            .filter((v): v is string => typeof v === 'string' && HEX_COLOUR.test(v))
            .slice(0, BANNER_LIMITS.maxStops)
            .map((v) => v.toLowerCase()),
        }
      : {}),
    angle: clamp(o.angle, 0, 360, 0),
    spread: clamp(o.spread, BANNER_LIMITS.minSpread, BANNER_LIMITS.maxSpread, 100),
    radius: clamp(o.radius, 0, BANNER_LIMITS.maxRadius, 12),
    layers,
  };
}

/**
 * Reads a version 1 banner as a version 2 one.
 *
 * ★ WHY MIGRATE RATHER THAN REFUSE ★
 *
 * Version 1 shipped and members built banners with it. Refusing those would blank their signature
 * with no explanation and no way back — the spec is the only copy, so "rebuild it" would mean
 * "your work is gone".
 *
 * The mapping is mechanical: the nine anchors were three rows crossed with three alignments, and
 * the palette names were always hex underneath.
 */
function migrateV1(raw: Record<string, unknown>): BannerSpec {
  const NAMED: Record<string, string> = {
    orange: '#ff7100',
    cyan: '#5cd9ff',
    gold: '#ffc400',
    steel: '#93a4b8',
    light: '#e8eef5',
    dark: '#0b0f14',
  };
  const colour = (v: unknown, fallback: string): string =>
    typeof v === 'string' ? (NAMED[v] ?? (HEX_COLOUR.test(v) ? v : fallback)) : fallback;

  const OLD_SOURCE: Record<string, BannerTextSource> = {
    commander: 'commander',
    rank: 'squadronRank',
    squadron: 'squadron',
    custom: 'custom',
  };

  const layers = (Array.isArray(raw['layers']) ? raw['layers'] : []).map(
    (l): Record<string, unknown> => {
      const layer = l as Record<string, unknown>;
      const anchor = typeof layer['anchor'] === 'string' ? layer['anchor'] : 'middle-left';
      const [vertical, horizontal] = anchor.split('-');
      return {
        ...layer,
        row: vertical === 'top' ? 1 : vertical === 'bottom' ? 3 : 2,
        align: horizontal === 'center' ? 'center' : horizontal === 'right' ? 'right' : 'left',
        source: OLD_SOURCE[String(layer['source'])] ?? 'custom',
        colour: colour(layer['colour'], '#e8eef5'),
      };
    },
  );

  return validateBannerSpec({
    version: 2,
    background: raw['background'] ?? 'gradient',
    colourA: colour(raw['colourA'], '#0b0f14'),
    colourB: colour(raw['colourB'], '#ff7100'),
    ...(typeof raw['imageMediaId'] === 'string' ? { imageMediaId: raw['imageMediaId'] } : {}),
    dim: raw['dim'] ?? 0,
    layers,
  });
}

/**
 * A starting banner, so the generator is never a blank rectangle.
 *
 * An empty canvas is the hardest thing to hand somebody. This is a real, three-line banner on first
 * open — their name, their ranks, their squadron — which they then change rather than build.
 */
export function defaultBannerSpec(): BannerSpec {
  return {
    version: 2,
    background: 'gradient',
    colourA: '#0b0f14',
    colourB: '#ff7100',
    dim: 0,
    angle: 0,
    spread: 100,
    radius: 12,
    layers: [
      {
        kind: 'text',
        source: 'commander',
        row: 1,
        align: 'left',
        size: 28,
        bold: true,
        colour: '#e8eef5',
        mono: false,
      },
      {
        kind: 'text',
        source: 'squadronRank',
        row: 2,
        align: 'left',
        size: 15,
        bold: false,
        colour: '#ff9d3f',
        mono: true,
      },
      {
        kind: 'text',
        source: 'combat',
        label: 'CMB',
        row: 3,
        align: 'left',
        size: 12,
        bold: false,
        colour: '#93a4b8',
        mono: true,
      },
      {
        kind: 'text',
        source: 'trade',
        label: 'TRD',
        row: 3,
        align: 'left',
        size: 12,
        bold: false,
        colour: '#93a4b8',
        mono: true,
      },
      {
        kind: 'text',
        source: 'explore',
        label: 'EXP',
        row: 3,
        align: 'left',
        size: 12,
        bold: false,
        colour: '#93a4b8',
        mono: true,
      },
      { kind: 'badge', badge: 'squadron', row: 2, align: 'right', size: 96 },
    ],
  };
}

/* ------------------------------------------------- sharing it elsewhere */

/**
 * Signature markup for OTHER forums.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "can we add a Signature BBCode so we can share this to other forums to our signatures / banners
 * etc?"
 *
 * ★ WHY THIS NEEDS A PUBLISHED IMAGE, AND WHAT THAT COSTS ★
 *
 * BBCode has no way to describe a banner. `[img]` takes a URL and nothing else — so an external
 * forum can only ever show a FLAT IMAGE at a public address. Everything the on-site banner does
 * that a picture cannot (resolving "my rank" when it is drawn, so a promotion updates every banner
 * automatically) stops at our own boundary.
 *
 * So sharing means publishing: the browser rasterises the live banner exactly as it appears, that
 * PNG is stored like any other upload, and the BBCode points at it. The consequence is worth
 * stating plainly rather than discovering — a published banner is a SNAPSHOT. Get promoted, and the
 * copy on our forum updates itself while the one pasted into another forum still says Cadet until
 * it is published again.
 *
 * ★ AND WHY THE URL IS ABSOLUTE ★
 *
 * A relative path is meaningless once it leaves this site. That means the base URL becomes part of
 * something we hand to third parties and cannot recall: every copy pasted elsewhere keeps pointing
 * at whatever address it was generated with. Moving domains breaks them until each member updates
 * their signature on each forum — one place per forum, not per post, so it is recoverable, but it
 * is a real cost and belongs in the copy on the page, not only here.
 */

/** Escapes a value being placed inside a BBCode tag attribute. */
function bbSafe(value: string): string {
  /*
   * `]` and `[` are the only characters that can break OUT of a tag and start another. A URL
   * containing one is almost certainly hostile or broken; either way it is stripped rather than
   * escaped, because BBCode has no escape syntax to escape it WITH.
   *
   * Newlines go too: a linebreak inside `[url=...]` splits the tag and the remainder renders as
   * literal text on somebody else's forum.
   */
  return value.replace(/[[\]\r\n]/g, '').trim();
}

export interface SignatureShare {
  /** Absolute URL of the published banner image. */
  readonly bannerUrl: string;
  /** Where the banner points, if anywhere. Already allowlist-checked when it was saved. */
  readonly link: string | null;
  readonly tagline: string | null;
}

/**
 * BBCode for a signature — the format almost every forum outside this one speaks.
 *
 * Wrapped in `[url]` only when there is somewhere to go. A `[url=]` with an empty target renders
 * as a dead link on some forums and as literal text on others, and neither is what anybody wanted.
 */
export function signatureBBCode(share: SignatureShare): string {
  const img = `[img]${bbSafe(share.bannerUrl)}[/img]`;
  const link = share.link === null ? '' : bbSafe(share.link);

  const banner = link === '' ? img : `[url=${link}]${img}[/url]`;

  const tagline = share.tagline === null ? '' : bbSafe(share.tagline);

  // The tagline goes BELOW the banner, matching how it reads on our own forum.
  return tagline === '' ? banner : `${banner}\n${tagline}`;
}

/**
 * The same thing in Markdown, for the places that use it.
 *
 * Included because it is the same three values rearranged, and because "other forums" in practice
 * also means Discord, GitHub and anywhere else a member pastes a signature. Offering only BBCode
 * would send somebody to hand-convert it and get the nesting wrong.
 */
export function signatureMarkdown(share: SignatureShare): string {
  const alt = share.tagline ?? 'Signature';
  const img = `![${alt.replace(/[[\]]/g, '')}](${share.bannerUrl})`;
  const banner = share.link === null ? img : `[${img}](${share.link})`;

  /*
   * ★ THE TAGLINE IS ESCAPED TOO, NOT ONLY THE ALT TEXT ★
   *
   * The first version escaped the alt text and appended the tagline raw, so a tagline containing
   * `[free ships](somewhere)` stayed live and became a real LINK on the target forum. Not a
   * security hole — it is the member's own signature going into their own post — but a surprise,
   * and the whole point of generating this is that what they see here is what they get there.
   *
   * Brackets only. Escaping every Markdown metacharacter would fill an ordinary tagline with
   * backslashes to prevent a problem that punctuation does not cause.
   */
  const tagline = share.tagline === null ? null : share.tagline.replace(/([[\]])/g, '\\$1');
  return tagline === null ? banner : `${banner}\n\n${tagline}`;
}

/** Plain HTML, for forums that accept it. Attributes are quoted and the URL is escaped. */
export function signatureHtml(share: SignatureShare): string {
  const esc = (v: string): string =>
    v
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const img = `<img src="${esc(share.bannerUrl)}" alt="${esc(share.tagline ?? 'Signature')}" width="600" height="120">`;
  /*
   * `rel="noopener noreferrer"` even here. It is markup we are handing somebody to paste on a site
   * we do not control, and shipping a link without it teaches the habit by example.
   */
  return share.link === null
    ? img
    : `<a href="${esc(share.link)}" rel="noopener noreferrer">${img}</a>`;
}
