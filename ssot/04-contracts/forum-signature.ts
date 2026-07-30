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
 * The banner: 600 × 120, and why it is one fixed size.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "for the banner, we want this to be generated and created in the signature genrator if they want
 * to make their own, or they can upload one, create size rules for it and enforce them show them on
 * the page in px" — and, asked which size and how strict: 600 × 120, with uploads auto-fitted.
 *
 * ★ ONE SIZE, NOT A RANGE ★
 *
 * A banner appears under every post in a thread, so a column of banners at differing heights makes
 * the page jitter as it scrolls. Fixing the size is what keeps a thread readable, and it is also
 * what lets the generator lay text out reliably — a layout engine that has to work at any aspect
 * ratio is one that looks wrong at most of them.
 */
export const BANNER = {
  width: 600,
  height: 120,
  /**
   * The smallest upload worth accepting.
   *
   * Below this, scaling up produces a blurred mess and the member blames us rather than their
   * source file. Refused with the numbers stated, which is the only refusal anybody can act on.
   */
  minUploadWidth: 300,
  minUploadHeight: 60,
} as const;

/** Backgrounds the generator can build without anybody uploading anything. */
export const BANNER_BACKGROUNDS = ['solid', 'gradient', 'starfield', 'image'] as const;
export type BannerBackground = (typeof BANNER_BACKGROUNDS)[number];

/**
 * Where a layer sits.
 *
 * ★ NINE ANCHORS, NOT FREE COORDINATES ★
 *
 * Drag-anywhere positioning sounds more capable and produces worse banners: text half off the
 * edge, overlapping badges, and a layout that breaks the moment a rank name is longer than the one
 * it was positioned against. Anchors keep every arrangement aligned to the same grid, and a
 * promotion from "Cadet" to "Chief Fleet Commander" still lands somewhere sensible.
 */
export const BANNER_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;
export type BannerAnchor = (typeof BANNER_ANCHORS)[number];

/** What a text layer says. Resolved at render time so a rename or promotion updates the banner. */
export const BANNER_TEXT_SOURCES = ['commander', 'rank', 'squadron', 'custom'] as const;
export type BannerTextSource = (typeof BANNER_TEXT_SOURCES)[number];

/** Badges we hold ourselves. Never an arbitrary image — see `BannerBadgeLayer`. */
export const BANNER_BADGES = ['squadron', 'rank'] as const;
export type BannerBadge = (typeof BANNER_BADGES)[number];

export interface BannerTextLayer {
  readonly kind: 'text';
  /**
   * `custom` uses `text`; everything else is looked up from the profile AT RENDER TIME.
   *
   * ★ RESOLVED LATE, ON PURPOSE ★
   *
   * Baking "CMDR Grim — Sector Overseer" into the stored banner means a promotion leaves every
   * past banner claiming the old rank, and the member has to know to come back and rebuild it.
   * Storing the SOURCE means the banner stays right forever without anybody maintaining it.
   */
  readonly source: BannerTextSource;
  /** Only used when `source` is `custom`. Plain text, escaped at render. */
  readonly text?: string;
  readonly anchor: BannerAnchor;
  /** Bounded, so a layer cannot be sized past the banner and off the edge of the world. */
  readonly size: number;
  readonly bold: boolean;
  /** A palette colour, never a hex value — same reasoning as the signature accent. */
  readonly colour: SignatureAccent | 'light' | 'dark';
  /** Monospace with wide tracking: the console look the rest of the site uses for labels. */
  readonly mono: boolean;
}

export interface BannerBadgeLayer {
  readonly kind: 'badge';
  /**
   * ★ A NAMED BADGE, NOT AN IMAGE ID ★
   *
   * The squadron mark and the rank insignia are OURS. Letting this carry an arbitrary media id
   * would make a banner able to composite any uploaded image at any position — a second image
   * pipeline with none of the fitting rules the background has.
   */
  readonly badge: BannerBadge;
  readonly anchor: BannerAnchor;
  readonly size: number;
}

export type BannerLayer = BannerTextLayer | BannerBadgeLayer;

export interface BannerSpec {
  readonly version: 1;
  readonly background: BannerBackground;
  /** For `solid` and `gradient`. Palette names only. */
  readonly colourA: SignatureAccent | 'dark';
  readonly colourB: SignatureAccent | 'dark';
  /**
   * For `image`: OUR media id, already fitted to 600 × 120 on upload.
   *
   * There is no URL field, for the same reason the rich document has none — a banner cannot
   * reference a third-party host because there is nowhere to write one.
   */
  readonly imageMediaId?: string;
  /** How much to dim the background so text stays readable on top of it. Percent. */
  readonly dim: number;
  readonly layers: readonly BannerLayer[];
}

/** Hard limits. A banner is 600 × 120; nothing here needs to be generous. */
export const BANNER_LIMITS = {
  maxLayers: 8,
  minTextSize: 10,
  maxTextSize: 48,
  minBadgeSize: 16,
  maxBadgeSize: 96,
  maxCustomText: 48,
  maxDim: 80,
} as const;

/**
 * Validates a banner spec that arrived from a browser.
 *
 * ★ CLAMPS NUMBERS, REFUSES STRUCTURE ★
 *
 * Every numeric field is clamped rather than rejected: a size outside the range is a slider bug or
 * an older client, not an attack, and losing somebody's whole banner because one number is 49
 * would be a bad trade. Anything structurally wrong — an unknown layer kind, a background nobody
 * defined — is refused, because there is no sensible value to substitute.
 */
export function validateBannerSpec(raw: unknown): BannerSpec {
  const fail = (why: string): never => {
    throw new Error(why);
  };
  const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
    const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
    return Math.min(hi, Math.max(lo, Math.round(v)));
  };

  /*
   * A direct `throw`, not `fail(...)`.
   *
   * TypeScript only narrows after a never-returning call when the callee is a function DECLARATION
   * or an explicitly-annotated variable — a `const fail = (): never =>` does not narrow, so every
   * later `o.` was an error on a possibly-null value. Throwing inline is clearer than annotating
   * around the limitation.
   */
  if (raw === null || typeof raw !== 'object') {
    throw new Error('That banner is not in a shape we recognise.');
  }
  const o = raw as Partial<BannerSpec>;
  if (o.version !== 1) fail('That banner was made by a different version of the editor.');

  const background = o.background ?? 'gradient';
  if (!(BANNER_BACKGROUNDS as readonly string[]).includes(background)) {
    fail('That is not one of our backgrounds.');
  }

  const colour = (v: unknown): SignatureAccent | 'dark' =>
    v === 'dark' || (SIGNATURE_ACCENTS as readonly string[]).includes(v as string)
      ? (v as SignatureAccent | 'dark')
      : 'dark';

  const rawLayers = Array.isArray(o.layers) ? o.layers : [];
  if (rawLayers.length > BANNER_LIMITS.maxLayers) {
    fail(`A banner can hold ${BANNER_LIMITS.maxLayers} layers.`);
  }

  const layers: BannerLayer[] = rawLayers.map((l): BannerLayer => {
    /*
     * Typed as a loose record of unknowns rather than `Partial<TextLayer & BadgeLayer>`.
     *
     * That intersection collapses `kind` to `'text' & 'badge'`, which is `never` — so every field
     * access after the narrowing became an error on a value TypeScript believed could not exist.
     * A record of unknowns is also the honest description: this is untrusted input, and nothing is
     * known about it until it is checked.
     */
    const layer = l as {
      kind?: unknown;
      badge?: unknown;
      anchor?: unknown;
      size?: unknown;
      source?: unknown;
      text?: unknown;
      bold?: unknown;
      colour?: unknown;
      mono?: unknown;
    };
    const anchor = (BANNER_ANCHORS as readonly string[]).includes(layer.anchor as string)
      ? (layer.anchor as BannerAnchor)
      : 'middle-left';

    if (layer.kind === 'badge') {
      if (!(BANNER_BADGES as readonly string[]).includes(layer.badge as string)) {
        fail('That is not one of our badges.');
      }
      return {
        kind: 'badge',
        badge: layer.badge as BannerBadge,
        anchor,
        size: clamp(layer.size, BANNER_LIMITS.minBadgeSize, BANNER_LIMITS.maxBadgeSize, 48),
      };
    }

    if (layer.kind !== 'text') fail('That is not one of our layer types.');

    const source = (BANNER_TEXT_SOURCES as readonly string[]).includes(layer.source as string)
      ? (layer.source as BannerTextSource)
      : 'custom';

    const text =
      typeof layer.text === 'string' ? layer.text.trim().slice(0, BANNER_LIMITS.maxCustomText) : '';

    const textColour =
      layer.colour === 'light' || layer.colour === 'dark'
        ? layer.colour
        : (SIGNATURE_ACCENTS as readonly string[]).includes(layer.colour as string)
          ? (layer.colour as SignatureAccent)
          : 'light';

    return {
      kind: 'text',
      source,
      ...(source === 'custom' ? { text } : {}),
      anchor,
      size: clamp(layer.size, BANNER_LIMITS.minTextSize, BANNER_LIMITS.maxTextSize, 18),
      bold: layer.bold === true,
      colour: textColour,
      mono: layer.mono === true,
    };
  });

  return {
    version: 1,
    background: background as BannerBackground,
    colourA: colour(o.colourA),
    colourB: colour(o.colourB),
    ...(typeof o.imageMediaId === 'string' && o.imageMediaId !== ''
      ? { imageMediaId: o.imageMediaId }
      : {}),
    dim: clamp(o.dim, 0, BANNER_LIMITS.maxDim, 0),
    layers,
  };
}

/**
 * A starting banner, so the generator is never a blank rectangle.
 *
 * An empty canvas is the hardest thing to hand somebody. This is a real banner on first open —
 * their name, their squadron, squadron colours — which they then change rather than build.
 */
export function defaultBannerSpec(): BannerSpec {
  return {
    version: 1,
    background: 'gradient',
    colourA: 'dark',
    colourB: 'orange',
    dim: 0,
    layers: [
      {
        kind: 'text',
        source: 'commander',
        anchor: 'middle-left',
        size: 26,
        bold: true,
        colour: 'light',
        mono: false,
      },
      {
        kind: 'text',
        source: 'squadron',
        anchor: 'bottom-left',
        size: 12,
        bold: false,
        colour: 'orange',
        mono: true,
      },
      { kind: 'badge', badge: 'squadron', anchor: 'middle-right', size: 72 },
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
