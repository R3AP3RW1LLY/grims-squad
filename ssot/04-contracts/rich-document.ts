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
export type MarkType = 'bold' | 'italic' | 'strike' | 'code' | 'link';

export interface DocMark {
  readonly type: MarkType;
  /** Only `link` carries anything, and only an href. */
  readonly href?: string;
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
}

export interface ParagraphNode {
  readonly type: 'paragraph';
  readonly align?: Alignment;
  readonly content?: readonly TextNode[];
}

export interface HeadingNode {
  readonly type: 'heading';
  /** 2 and 3 only. A post's title is the page's h1; a body that could emit one would compete with it. */
  readonly level: 2 | 3;
  readonly content?: readonly TextNode[];
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
