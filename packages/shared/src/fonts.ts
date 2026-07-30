/**
 * The fonts a commander can choose (P2).
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "add google fonts to the signature generator and the text editor! allow commanders to select a
 * default google font they can use in their forum posts and signatures" — and, asked how many:
 * a larger set, 25–30.
 *
 * ★ SELF-HOSTED, NOT LOADED FROM GOOGLE ★
 *
 * The obvious build is a `<link>` to fonts.googleapis.com. It is also the one thing this project
 * has consistently refused: `font-src 'self'` in the CSP, and the note beside it says a CDN "would
 * leak a request per visitor to a third party". A font request carries an IP and a referrer, on
 * every page load, for every visitor including anonymous ones reading the public recruiting pages.
 *
 * So `tools/fetch-fonts.ts` downloads the woff2 files once, into our own `public/fonts`, and
 * generates the `@font-face` rules against those local paths. Same fonts, same picker, no request
 * ever leaves our server, and the existing CSP needs no loosening — which is the point: a rule that
 * gets relaxed for a feature was not a rule.
 *
 * ★ LATIN SUBSET ONLY ★
 *
 * Google serves a `latin` and a `latin-ext` slice per family. Taking latin alone is roughly half
 * the bytes for a squadron whose display names are overwhelmingly ASCII — and a name that needs
 * latin-ext still RENDERS, it just falls back to the site face for those characters rather than
 * failing.
 */

/** What a family is for, so the picker groups rather than listing thirty names. */
export type FontCategory = 'display' | 'sans' | 'serif' | 'mono' | 'stencil';

export interface FontFamily {
  /** Stable id, used in stored documents and specs. Never the display name. */
  readonly id: string;
  /** The Google family name, and the CSS `font-family` we register it under. */
  readonly name: string;
  readonly category: FontCategory;
  /**
   * Weights to fetch.
   *
   * Declared rather than guessed, because a family that has no 700 returns a 400 from the CSS API
   * for the whole request — so one wrong entry would silently drop a font from the build. The
   * fetch script retries with 400 alone when a request fails, and says so, rather than dying.
   */
  readonly weights: readonly number[];
}

/**
 * The catalogue.
 *
 * ★ CHOSEN FOR A SQUADRON, NOT FOR A DESIGN SYSTEM ★
 *
 * Heavy on the sci-fi display and technical-mono ranges, because that is what people building an
 * Elite Dangerous signature reach for. The sans and serif families are there so a long post stays
 * readable — somebody who sets their body text in Audiowide will find out quickly, and somebody
 * who wants Inter should not have to pick between two novelty faces.
 */
export const FONT_FAMILIES: readonly FontFamily[] = [
  // ── display / sci-fi ────────────────────────────────────────────────────
  { id: 'orbitron', name: 'Orbitron', category: 'display', weights: [400, 700] },
  { id: 'michroma', name: 'Michroma', category: 'display', weights: [400] },
  { id: 'audiowide', name: 'Audiowide', category: 'display', weights: [400] },
  { id: 'chakra-petch', name: 'Chakra Petch', category: 'display', weights: [400, 700] },
  { id: 'syncopate', name: 'Syncopate', category: 'display', weights: [400, 700] },
  { id: 'bruno-ace', name: 'Bruno Ace', category: 'display', weights: [400] },
  { id: 'turret-road', name: 'Turret Road', category: 'display', weights: [400, 700] },
  { id: 'russo-one', name: 'Russo One', category: 'display', weights: [400] },

  // ── sans ────────────────────────────────────────────────────────────────
  { id: 'inter', name: 'Inter', category: 'sans', weights: [400, 700] },
  { id: 'rajdhani', name: 'Rajdhani', category: 'sans', weights: [400, 700] },
  { id: 'exo-2', name: 'Exo 2', category: 'sans', weights: [400, 700] },
  { id: 'titillium-web', name: 'Titillium Web', category: 'sans', weights: [400, 700] },
  { id: 'barlow', name: 'Barlow', category: 'sans', weights: [400, 700] },
  { id: 'oswald', name: 'Oswald', category: 'sans', weights: [400, 700] },
  { id: 'roboto-condensed', name: 'Roboto Condensed', category: 'sans', weights: [400, 700] },
  { id: 'archivo', name: 'Archivo', category: 'sans', weights: [400, 700] },
  { id: 'manrope', name: 'Manrope', category: 'sans', weights: [400, 700] },
  { id: 'saira', name: 'Saira', category: 'sans', weights: [400, 700] },
  { id: 'work-sans', name: 'Work Sans', category: 'sans', weights: [400, 700] },

  // ── serif ───────────────────────────────────────────────────────────────
  { id: 'spectral', name: 'Spectral', category: 'serif', weights: [400, 700] },
  { id: 'bitter', name: 'Bitter', category: 'serif', weights: [400, 700] },
  { id: 'zilla-slab', name: 'Zilla Slab', category: 'serif', weights: [400, 700] },
  { id: 'cormorant-garamond', name: 'Cormorant Garamond', category: 'serif', weights: [400, 700] },

  // ── mono ────────────────────────────────────────────────────────────────
  { id: 'jetbrains-mono', name: 'JetBrains Mono', category: 'mono', weights: [400, 700] },
  { id: 'share-tech-mono', name: 'Share Tech Mono', category: 'mono', weights: [400] },
  { id: 'ibm-plex-mono', name: 'IBM Plex Mono', category: 'mono', weights: [400, 700] },
  { id: 'space-mono', name: 'Space Mono', category: 'mono', weights: [400, 700] },
  { id: 'fira-code', name: 'Fira Code', category: 'mono', weights: [400, 700] },

  // ── stencil / military ──────────────────────────────────────────────────
  { id: 'black-ops-one', name: 'Black Ops One', category: 'stencil', weights: [400] },
  { id: 'saira-stencil-one', name: 'Saira Stencil One', category: 'stencil', weights: [400] },
  { id: 'wallpoet', name: 'Wallpoet', category: 'stencil', weights: [400] },
];

/** Human labels for the picker's groups. */
export const FONT_CATEGORY_LABELS: Record<FontCategory, string> = {
  display: 'Display',
  sans: 'Sans',
  serif: 'Serif',
  mono: 'Monospace',
  stencil: 'Stencil',
};

/**
 * The id meaning "whatever the site uses".
 *
 * ★ A REAL VALUE, NOT NULL ★
 *
 * Null would mean "unset", and "unset" and "deliberately the site font" are different intentions —
 * the second has to survive a future change to what the default is. This is also what a reader's
 * override resolves to, so there is one name for the concept everywhere.
 */
export const FONT_SITE_DEFAULT = 'site';

/** Whether an id names a font we actually serve. Everything stored is checked against this. */
export function isKnownFont(id: string): boolean {
  return id === FONT_SITE_DEFAULT || FONT_FAMILIES.some((f) => f.id === id);
}

/**
 * The CSS `font-family` value for an id.
 *
 * ★ THE STACK IS BUILT HERE, NOT STORED ★
 *
 * Documents store an ID. If they stored a CSS value, a member-authored string would reach a `style`
 * attribute — and a font stack is one of the few CSS values that happily accepts arbitrary text.
 * Resolving the id against this table means an unknown id renders as the site font rather than as
 * whatever the string happened to say.
 *
 * The fallback tail matters: a family that failed to download, or has not loaded yet, falls back
 * to something of the same shape rather than to a serif default that reflows the whole post.
 */
export function fontStack(id: string): string {
  const family = FONT_FAMILIES.find((f) => f.id === id);
  if (family === undefined) return 'inherit';

  const tail =
    family.category === 'mono'
      ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
      : family.category === 'serif'
        ? 'Georgia, serif'
        : 'system-ui, -apple-system, Segoe UI, sans-serif';

  /*
   * Quoted, because several names contain spaces and one contains a digit after a space ("Exo 2").
   * An unquoted multi-word family name is a parse error that silently drops the declaration.
   */
  return `'${family.name}', ${tail}`;
}
