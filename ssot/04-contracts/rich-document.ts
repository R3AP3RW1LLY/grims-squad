/**
 * The rich document format (P2.3).
 *
 * ★ WHY A NODE TREE AND NOT HTML ★
 *
 * Squadron owner, 2026-07-30: "create us a 100% custom text editor that matches the features
 * of word ... image attachments, placement editing, youtube video embedding, headers, text
 * editing the whole shebang", and — importantly — EVERY MEMBER gets it, not just officers.
 *
 * That last part decides the storage format. A rich editor emitting HTML means the sanitiser
 * faces arbitrary untrusted markup from 107 people, and every new capability (alignment,
 * width, embeds) means widening an HTML allowlist — the exact surface narrowed all week.
 *
 * A validated node tree inverts it. The server does not ask "is this HTML safe", it asks "is
 * this one of eleven node types I know, with attributes of the right shape". Anything else is
 * rejected before it is stored. Image placement and video embeds become DATA rather than
 * markup, so they can be rendered differently later without re-parsing anyone's content.
 *
 * ★ THE HTML IS GENERATED, NEVER ACCEPTED ★
 *
 * `body_doc` (this format) is the source of truth. `body_html` is derived from it on the
 * server and stored for reading. The client never supplies HTML for a rich post — which means
 * there is no path where member markup reaches a page, and INV-035 holds by construction
 * rather than by sanitising well.
 *
 * ★ DELIBERATELY SMALL ★
 *
 * Eleven node types and three marks. Everything a joining guide or an announcement needs, and
 * nothing whose rendering nobody can predict. Tables, footnotes, columns and arbitrary colour
 * are all absent — each would be a new rendering path, and "Word has it" is not on its own a
 * reason for a squadron forum to have it.
 */

/** Text styling. A closed set, so a mark nobody planned for cannot appear. */
export type MarkType =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'link'
  | 'mention'
  | 'font';

export interface DocMark {
  readonly type: MarkType;
  /** Only `link` carries anything, and only an href. */
  readonly href?: string;
  /**
   * Only `mention` carries this: the id of the member being addressed.
   *
   * ★ AN ID, NOT A PARSED NAME ★
   *
   * The obvious implementation scans stored text for `@something` at render time and tries to match
   * it against the roster. That is wrong three ways: a member who renames breaks every past
   * mention, two members with similar display names are ambiguous forever, and the scan runs on
   * every read of every post.
   *
   * Resolving it ONCE, when the author picks somebody from the autocomplete, makes a mention a
   * fact rather than a guess. The display text is stored alongside so the post still reads
   * correctly if that account is later deleted.
   */
  readonly userId?: string;
  /**
   * Only `font` carries this: an id from the font catalogue.
   *
   * ★ AN ID, NEVER A CSS VALUE ★
   *
   * Squadron owner, 2026-07-30: commanders pick a font "they can use in their forum posts and
   * signatures", and may "use multiple fonts if they want too" — so this is a MARK on a run of
   * text rather than a property of the post, which is what makes two fonts in one paragraph
   * possible at all.
   *
   * Storing the id and resolving it at render is the whole safety story. A stored `font-family`
   * would be member-authored text reaching a `style` attribute, and a font stack is one of the very
   * few CSS values that accepts arbitrary content — so an unknown id renders as the site font
   * rather than as whatever the string happened to say.
   */
  readonly font?: string;
}

export interface TextNode {
  readonly type: 'text';
  readonly text: string;
  readonly marks?: readonly DocMark[];
}

/** Where a block sits relative to the text around it. */
export type Alignment = 'left' | 'center' | 'right';

/**
 * An image the member uploaded.
 *
 * ★ `mediaId`, NOT A URL ★
 *
 * The document stores OUR upload id and nothing else. The URL is constructed at render time,
 * which means a document can never reference a third-party host — the privacy rule that
 * `isOwnMediaSrc` enforces for Markdown posts becomes structurally impossible to break here,
 * because there is no field in which to put a foreign address.
 *
 * `widthPercent` rather than pixels: a fixed pixel width is wrong on a phone, and every
 * "why is my screenshot cut off" report traces back to one.
 */
export interface ImageNode {
  readonly type: 'image';
  readonly mediaId: string;
  /** Author's description. Not decoration — a screenshot with no alt text is invisible to some readers. */
  readonly alt: string;
  readonly align: Alignment;
  /** 25–100. Clamped rather than rejected: an out-of-range value is a slider bug, not an attack. */
  readonly widthPercent: number;
  readonly caption?: string;
}

/**
 * A YouTube video.
 *
 * ★ THE ID ONLY, AND NO IFRAME UNTIL A READER ASKS ★
 *
 * Owner chose click-to-play. So this stores an 11-character video id, the renderer shows OUR
 * thumbnail, and the YouTube iframe is created by a click. Two reasons that matters beyond
 * CSP: an always-embedded player reports every reader of the page to Google whether they watch
 * or not, and this squadron includes minors (D15). One narrow `frame-src` allowance, taken on
 * purpose, only after an explicit action.
 *
 * Storing a URL instead would mean parsing it at render time forever, and the parser is where
 * an open redirect eventually hides.
 */
export interface YouTubeNode {
  readonly type: 'youtube';
  readonly videoId: string;
  readonly title?: string;
  /**
   * OUR copy of the video's thumbnail, fetched server-side once at save time.
   *
   * ★ NOT A YOUTUBE URL, FOR THE SAME REASON THE IFRAME IS NOT EMBEDDED ★
   *
   * Pointing an `<img>` at i.ytimg.com would report every reader of the page to Google on load —
   * before anybody decides to watch anything, and including anonymous visitors reading the public
   * guides. That is precisely what the click-to-play placeholder exists to prevent, so a thumbnail
   * that leaked it would quietly undo the feature it decorates.
   *
   * So the server fetches it once and stores it like any other upload, and this is our media id.
   * Absent when the fetch failed or the video has no thumbnail — the post keeps the CSS
   * placeholder it has always had, because losing a preview is not a reason to refuse a post.
   */
  readonly thumbMediaId?: string;
}

export interface ParagraphNode {
  readonly type: 'paragraph';
  readonly align?: Alignment;
  readonly content?: readonly TextNode[];
}

export interface HeadingNode {
  readonly type: 'heading';
  /**
   * 2, 3 and 4 — shown in the toolbar as H1, H2 and H3.
   *
   * ★ THE LABEL AND THE TAG DELIBERATELY DIFFER ★
   *
   * Squadron owner, 2026-07-30, asked for "H1, H2, H3 and paragraph text". The post TITLE is
   * already the page's `<h1>`, and a body that emitted a second one would give the page two
   * competing answers to "what is this about" — which is what a screen reader's heading navigation
   * and a search engine both read.
   *
   * So the toolbar says H1 and the biggest body heading is an `<h2>` styled to look like one.
   * Nobody writing a post can tell the difference; everybody reading the page with assistive
   * technology can.
   */
  readonly level: 2 | 3 | 4;
  readonly content?: readonly TextNode[];
  /** Headings align too — an alignment that only worked on paragraphs would read as a bug. */
  readonly align?: Alignment;
}

export interface ListItemNode {
  readonly type: 'listItem';
  readonly content?: readonly ParagraphNode[];
}

export interface ListNode {
  readonly type: 'bulletList' | 'orderedList';
  readonly content?: readonly ListItemNode[];
}

export interface QuoteNode {
  readonly type: 'blockquote';
  readonly content?: readonly ParagraphNode[];
}

export interface CodeBlockNode {
  readonly type: 'codeBlock';
  /** Plain text. No language attribute: highlighting is a renderer decision, not content. */
  readonly text: string;
}

export interface DividerNode {
  readonly type: 'divider';
}

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | ListNode
  | QuoteNode
  | CodeBlockNode
  | ImageNode
  | YouTubeNode
  | DividerNode;

export interface RichDocument {
  /**
   * Format version.
   *
   * Present from the first document, because the alternative is guessing later which shape an
   * old row is in. A renderer that meets a version it does not know refuses rather than
   * rendering something it half-understands.
   */
  readonly version: 1;
  readonly content: readonly BlockNode[];
}

/** Hard limits, so a document cannot be used to exhaust anything. */
export const DOC_LIMITS = {
  /** Blocks in one document. A very long guide section is a few dozen. */
  maxBlocks: 400,
  /** Characters of text in one document, summed. */
  maxTextLength: 80_000,
  /** Images in one document. Twenty-five screenshots is already an unusual guide. */
  maxImages: 40,
  maxEmbeds: 10,
  /** Nesting is fixed by the type graph, but stated so the validator can assert it. */
  maxDepth: 3,
  minWidthPercent: 25,
  maxWidthPercent: 100,
} as const;

/**
 * A YouTube video id.
 *
 * Exactly 11 characters of the URL-safe alphabet. Anchored at both ends, because an unanchored
 * pattern would match an id inside a longer hostile string — the same lesson the media-id
 * pattern recorded.
 */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Link schemes a member may use. Matches the Markdown sanitiser: no javascript:, no data:. */
export const DOC_LINK_SCHEMES = ['http', 'https', 'mailto'] as const;
