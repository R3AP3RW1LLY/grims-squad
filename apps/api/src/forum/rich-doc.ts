import {
  DOC_LIMITS,
  DOC_LINK_SCHEMES,
  YOUTUBE_ID,
  type Alignment,
  type BlockNode,
  type DocMark,
  type RichDocument,
  type TextNode,
} from '@grims/shared';
import { AppError, ErrorCode } from '@grims/shared';
import { MEDIA_PATH_PREFIX } from './sanitize.js';

/**
 * Validating a rich document and turning it into HTML (INV-035, P2.3).
 *
 * ★ THIS FILE IS WHY EVERY MEMBER CAN HAVE A RICH EDITOR ★
 *
 * Owner chose: everyone gets the editor, not just officers. That means the most capable input
 * surface in the application is open to 107 people, and the thing that makes it safe is here.
 *
 * The server NEVER accepts HTML for a rich post. It accepts a node tree, validates it against a
 * closed set of eleven types, and GENERATES the HTML itself. So the question is not "is this
 * markup safe" — a question with an endless tail — but "is this one of eleven shapes I know".
 * Anything else is refused before storage.
 *
 * Consequences worth stating, because they are the point:
 *
 *   - There is no field in a document that can hold a third-party URL for an image. Images
 *     carry OUR upload id, so the privacy rule `isOwnMediaSrc` enforces for Markdown is
 *     structurally unbreakable here rather than merely checked.
 *   - A `<script>` cannot appear in the output, because nothing in this file emits one and the
 *     input has no node type that could ask for one.
 *   - Every string that reaches HTML goes through `esc()`. There is exactly one place text
 *     becomes markup, so there is one place to get it right.
 *
 * ★ REFUSE, DO NOT REPAIR ★
 *
 * An unknown node type is an error, not something to drop silently. Dropping means a member
 * loses part of their post with no explanation, and it means a bug in the editor produces
 * quietly truncated content that nobody notices for weeks. The one exception is
 * `widthPercent`, which is CLAMPED — an out-of-range slider value is a UI bug, not an attack,
 * and refusing the whole post over it would be obnoxious.
 */

/** HTML-escapes text. The ONLY place a member's characters become markup. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fail(message: string): never {
  throw new AppError(ErrorCode.VALIDATION_FAILED, message);
}

const ALIGNMENTS: readonly Alignment[] = ['left', 'center', 'right'];

function isAlignment(v: unknown): v is Alignment {
  return typeof v === 'string' && (ALIGNMENTS as readonly string[]).includes(v);
}

/**
 * Is this link target allowed?
 *
 * Same schemes as the Markdown sanitiser. Parsed with `URL` rather than pattern-matched,
 * because a scheme check by prefix is defeated by leading whitespace and control characters —
 * the bypass the media-src rule documents at length.
 */
function linkAllowed(href: string): boolean {
  if (href.length > 2048) return false;
  // A relative link to our own site is fine and cannot name another origin.
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  try {
    const u = new URL(href);
    return (DOC_LINK_SCHEMES as readonly string[]).includes(u.protocol.replace(':', ''));
  } catch {
    return false;
  }
}

interface Counters {
  text: number;
  images: number;
  embeds: number;
}

function validateMarks(marks: unknown): readonly DocMark[] {
  if (marks === undefined) return [];
  if (!Array.isArray(marks)) fail('A text run had a malformed mark list.');
  if (marks.length > 8) fail('That text has too many styles applied at once.');

  return marks.map((m) => {
    const type = (m as { type?: unknown })?.type;
    switch (type) {
      case 'bold':
      case 'italic':
      case 'strike':
      case 'code':
        return { type } as DocMark;
      case 'link': {
        const href = (m as { href?: unknown }).href;
        if (typeof href !== 'string' || !linkAllowed(href)) {
          fail('A link in that post points somewhere we cannot allow. Use http, https or mailto.');
        }
        return { type: 'link', href };
      }
      case 'mention': {
        /*
         * ★ A UUID, VALIDATED — NOT A NAME TO BE MATCHED LATER ★
         *
         * The mention carries the id of the member being addressed, resolved once when the author
         * picked them from the autocomplete. Scanning stored text for `@something` at render time
         * would break every past mention when somebody renames, be ambiguous between similar
         * display names forever, and run on every read of every post.
         *
         * The display TEXT is the text node itself, so the post still reads correctly even if that
         * account is later deleted.
         */
        const userId = (m as { userId?: unknown }).userId;
        if (
          typeof userId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
        ) {
          fail('A mention in that post does not name anybody we recognise.');
        }
        return { type: 'mention', userId };
      }
      default:
        fail(`Unsupported text style: ${String(type)}.`);
    }
  });
}

function validateText(nodes: unknown, c: Counters): readonly TextNode[] {
  if (nodes === undefined) return [];
  if (!Array.isArray(nodes)) fail('A block had malformed contents.');

  return nodes.map((n) => {
    const node = n as { type?: unknown; text?: unknown; marks?: unknown };
    if (node.type !== 'text') fail(`Only text may appear there, not ${String(node.type)}.`);
    if (typeof node.text !== 'string') fail('A text run had no text.');

    c.text += node.text.length;
    if (c.text > DOC_LIMITS.maxTextLength) {
      fail('That post is too long. Split it into several posts.');
    }

    const marks = validateMarks(node.marks);
    return marks.length === 0 ? { type: 'text', text: node.text } : { type: 'text', text: node.text, marks };
  });
}

function validateBlock(raw: unknown, c: Counters, depth: number): BlockNode {
  if (depth > DOC_LIMITS.maxDepth) fail('That post is nested too deeply.');
  const node = raw as Record<string, unknown>;

  switch (node['type']) {
    case 'paragraph': {
      const align = node['align'];
      return {
        type: 'paragraph',
        ...(isAlignment(align) ? { align } : {}),
        content: validateText(node['content'], c),
      };
    }
    case 'heading': {
      const level = node['level'];
      /*
       * 2 and 3 only. The post's title is the page's h1, and a body that could emit another
       * would compete with it — bad for screen readers and for search.
       */
      if (level !== 2 && level !== 3) fail('Headings can only be level 2 or 3.');
      return { type: 'heading', level, content: validateText(node['content'], c) };
    }
    case 'bulletList':
    case 'orderedList': {
      const items = node['content'];
      if (items !== undefined && !Array.isArray(items)) fail('A list had malformed contents.');
      return {
        type: node['type'],
        content: ((items ?? []) as unknown[]).map((it) => {
          const item = it as Record<string, unknown>;
          if (item['type'] !== 'listItem') fail('Only list items may appear in a list.');
          const inner = item['content'];
          if (inner !== undefined && !Array.isArray(inner)) fail('A list item was malformed.');
          return {
            type: 'listItem' as const,
            content: ((inner ?? []) as unknown[]).map((p) => {
              const block = validateBlock(p, c, depth + 1);
              if (block.type !== 'paragraph') fail('A list item may only contain paragraphs.');
              return block;
            }),
          };
        }),
      };
    }
    case 'blockquote': {
      const inner = node['content'];
      if (inner !== undefined && !Array.isArray(inner)) fail('A quote was malformed.');
      return {
        type: 'blockquote',
        content: ((inner ?? []) as unknown[]).map((p) => {
          const block = validateBlock(p, c, depth + 1);
          if (block.type !== 'paragraph') fail('A quote may only contain paragraphs.');
          return block;
        }),
      };
    }
    case 'codeBlock': {
      const text = node['text'];
      if (typeof text !== 'string') fail('A code block had no contents.');
      c.text += text.length;
      if (c.text > DOC_LIMITS.maxTextLength) fail('That post is too long. Split it up.');
      return { type: 'codeBlock', text };
    }
    case 'image': {
      c.images += 1;
      if (c.images > DOC_LIMITS.maxImages) {
        fail(`A post can hold ${DOC_LIMITS.maxImages} images. Split it into several.`);
      }
      const mediaId = node['mediaId'];
      /*
       * ★ OUR UPLOAD ID, VALIDATED AS A UUID ★
       *
       * There is no URL field on this node type at all, so a document cannot reference another
       * host. That is the privacy guarantee made structural rather than checked: the renderer
       * builds the path itself from this id.
       */
      if (
        typeof mediaId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mediaId)
      ) {
        fail('An image in that post is not one of our uploads.');
      }
      const alt = node['alt'];
      if (typeof alt !== 'string' || alt.length > 500) fail('An image description was too long.');

      const rawWidth = node['widthPercent'];
      const width =
        typeof rawWidth === 'number' && Number.isFinite(rawWidth)
          ? Math.min(DOC_LIMITS.maxWidthPercent, Math.max(DOC_LIMITS.minWidthPercent, Math.round(rawWidth)))
          : 100;

      const align = node['align'];
      const caption = node['caption'];
      if (caption !== undefined && (typeof caption !== 'string' || caption.length > 500)) {
        fail('An image caption was too long.');
      }

      return {
        type: 'image',
        mediaId,
        alt,
        align: isAlignment(align) ? align : 'center',
        widthPercent: width,
        ...(typeof caption === 'string' && caption !== '' ? { caption } : {}),
      };
    }
    case 'youtube': {
      c.embeds += 1;
      if (c.embeds > DOC_LIMITS.maxEmbeds) {
        fail(`A post can hold ${DOC_LIMITS.maxEmbeds} videos.`);
      }
      const videoId = node['videoId'];
      if (typeof videoId !== 'string' || !YOUTUBE_ID.test(videoId)) {
        fail('That does not look like a YouTube video link.');
      }
      const title = node['title'];
      if (title !== undefined && (typeof title !== 'string' || title.length > 300)) {
        fail('That video title is too long.');
      }
      return {
        type: 'youtube',
        videoId,
        ...(typeof title === 'string' && title !== '' ? { title } : {}),
      };
    }
    case 'divider':
      return { type: 'divider' };
    default:
      fail(`Unsupported content: ${String(node['type'])}.`);
  }
}

/** Validates an untrusted document. Throws with a member-facing message. */
export function validateDocument(raw: unknown): RichDocument {
  const doc = raw as Record<string, unknown> | null;
  if (doc === null || typeof doc !== 'object') fail('That post had no content.');
  if (doc['version'] !== 1) fail('That post was written by an unsupported editor version.');

  const content = doc['content'];
  if (!Array.isArray(content)) fail('That post had no content.');
  if (content.length === 0) fail('Write something first.');
  if (content.length > DOC_LIMITS.maxBlocks) fail('That post has too many blocks. Split it up.');

  const counters: Counters = { text: 0, images: 0, embeds: 0 };
  const blocks = content.map((b) => validateBlock(b, counters, 1));

  /*
   * A document of nothing but empty paragraphs is an empty post. Checked on the VALIDATED tree
   * rather than on the raw input, so it cannot be fooled by an unusual shape.
   */
  /*
   * ★ MEASURED ON THE TEXT, NOT ON THE JSON ★
   *
   * The first version stringified `b.content` and looked for letters. Every node carries a
   * `type` field, so the WORD "paragraph" counted as substance and a document of empty
   * paragraphs sailed through as a valid post. Caught by its own test.
   *
   * Now it reuses `documentToText`, which is the same function search and notification previews
   * use — so "is this post empty" and "what does this post say" can never disagree.
   */
  const hasSubstance =
    blocks.some((b) => b.type === 'image' || b.type === 'youtube' || b.type === 'divider') ||
    documentToText({ version: 1, content: blocks }).trim() !== '';
  if (!hasSubstance) fail('Write something first.');

  return { version: 1, content: blocks };
}

/* ------------------------------------------------------------------ rendering */

function renderText(nodes: readonly TextNode[]): string {
  return nodes
    .map((n) => {
      let html = esc(n.text);
      /*
       * Marks applied INNERMOST-FIRST so the nesting is well formed whatever order the editor
       * listed them in. `code` wraps closest to the text, and a link wraps outermost so the
       * whole styled run is clickable.
       */
      const order: DocMark['type'][] = ['code', 'strike', 'italic', 'bold', 'mention', 'link'];
      for (const type of order) {
        const mark = n.marks?.find((m) => m.type === type);
        if (mark === undefined) continue;
        if (type === 'mention') {
          /*
           * Rendered as a link to the member's profile, carrying the id in a data attribute so the
           * client can style or hover-card it without re-parsing the name.
           *
           * `esc` has already been applied to the text; the id came from a uuid pattern, so nothing
           * here can carry markup. No `target="_blank"`: a mention points at our own site, and
           * opening an internal link in a new tab is a small rudeness.
           */
          html = `<a class="doc-mention" data-mention="${esc(mark.userId ?? '')}" href="/members/${esc(mark.userId ?? '')}">${html}</a>`;
        } else if (type === 'link') {
          /*
           * `rel` and `target` forced, exactly as the Markdown sanitiser does: a member cannot
           * clear `noopener`, which is what stops the opened page reaching `window.opener`.
           */
          html = `<a href="${esc(mark.href ?? '')}" rel="noopener noreferrer nofollow ugc" target="_blank">${html}</a>`;
        } else {
          const tag = type === 'strike' ? 'del' : type === 'italic' ? 'em' : type === 'bold' ? 'strong' : 'code';
          html = `<${tag}>${html}</${tag}>`;
        }
      }
      return html;
    })
    .join('');
}

const alignClass = (a: Alignment | undefined): string =>
  a === 'center' ? ' class="doc-center"' : a === 'right' ? ' class="doc-right"' : '';

function renderBlock(b: BlockNode): string {
  switch (b.type) {
    case 'paragraph':
      return `<p${alignClass(b.align)}>${renderText(b.content ?? [])}</p>`;
    case 'heading':
      return `<h${b.level}>${renderText(b.content ?? [])}</h${b.level}>`;
    case 'bulletList':
    case 'orderedList': {
      const tag = b.type === 'bulletList' ? 'ul' : 'ol';
      const items = (b.content ?? [])
        .map((li) => `<li>${(li.content ?? []).map(renderBlock).join('')}</li>`)
        .join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'blockquote':
      return `<blockquote>${(b.content ?? []).map(renderBlock).join('')}</blockquote>`;
    case 'codeBlock':
      return `<pre><code>${esc(b.text)}</code></pre>`;
    case 'divider':
      return '<hr />';
    case 'image': {
      /*
       * The path is BUILT here from our own prefix and the id. Nothing from the document
       * appears in the URL except a validated uuid, so this cannot become a foreign address.
       */
      const src = `${MEDIA_PATH_PREFIX}${b.mediaId}`;
      const figClass = `doc-figure doc-${b.align}`;
      const caption =
        b.caption === undefined ? '' : `<figcaption>${esc(b.caption)}</figcaption>`;
      return (
        `<figure class="${figClass}" style="width:${b.widthPercent}%">` +
        `<img src="${esc(src)}" alt="${esc(b.alt)}" loading="lazy" decoding="async" />` +
        `${caption}</figure>`
      );
    }
    case 'youtube': {
      /*
       * ★ NO IFRAME IN THE STORED HTML ★
       *
       * A placeholder carrying the video id. The client swaps in an iframe only when a reader
       * clicks — so `frame-src` stays locked for anybody who does not, and Google is not told
       * who read the page. This squadron includes minors (D15), which is part of why.
       *
       * The thumbnail comes from OUR media route only if somebody uploaded one; otherwise the
       * placeholder is drawn in CSS. Deliberately NOT img.youtube.com — that would leak the
       * reader to Google on page load, which is the whole thing being avoided.
       */
      const label = b.title === undefined ? 'Play video' : esc(b.title);
      return (
        `<div class="doc-embed" data-youtube="${esc(b.videoId)}">` +
        `<button type="button" class="doc-embed-play" data-youtube-play="${esc(b.videoId)}">` +
        `<span class="doc-embed-title">${label}</span>` +
        `<span class="doc-embed-hint">Click to load from YouTube</span>` +
        `</button></div>`
      );
    }
  }
}

/**
 * Renders a VALIDATED document to HTML.
 *
 * Takes `RichDocument`, not `unknown`: the type is only obtainable from `validateDocument`, so
 * the compiler prevents rendering something unchecked. That is the same trick as
 * `AclBoundClient` — make the unsafe call impossible to write rather than remembering not to.
 */
export function renderDocument(doc: RichDocument): string {
  return doc.content.map(renderBlock).join('\n');
}

/** Plain text, for search indexing and notification previews. */
export function documentToText(doc: RichDocument): string {
  const walk = (b: BlockNode): string => {
    switch (b.type) {
      case 'paragraph':
      case 'heading':
        return (b.content ?? []).map((t) => t.text).join('');
      case 'bulletList':
      case 'orderedList':
        return (b.content ?? []).flatMap((li) => (li.content ?? []).map(walk)).join(' ');
      case 'blockquote':
        return (b.content ?? []).map(walk).join(' ');
      case 'codeBlock':
        return b.text;
      case 'image':
        // The alt text IS content: a guide that is mostly screenshots should still be findable.
        return `${b.alt} ${b.caption ?? ''}`;
      case 'youtube':
        return b.title ?? '';
      case 'divider':
        return '';
    }
  };
  return doc.content.map(walk).join('\n').replace(/\s+/g, ' ').trim();
}

/**
 * Every member id mentioned in a document.
 *
 * ★ READ FROM THE VALIDATED TREE, NOT FROM THE HTML ★
 *
 * The alternative is scanning the rendered markup for `data-mention`, which would mean the
 * notification logic depends on how the renderer happens to format an attribute today. The tree is
 * the source of truth and the ids in it are already validated, so this cannot notify somebody whose
 * id was never accepted.
 *
 * De-duplicated: mentioning the same person three times in a post is one notification, because it
 * is one post.
 */
export function mentionedUserIds(doc: RichDocument): string[] {
  const found = new Set<string>();

  const fromText = (nodes: readonly TextNode[] | undefined): void => {
    for (const t of nodes ?? []) {
      for (const m of t.marks ?? []) {
        if (m.type === 'mention' && typeof m.userId === 'string') found.add(m.userId);
      }
    }
  };

  const walk = (b: BlockNode): void => {
    switch (b.type) {
      case 'paragraph':
      case 'heading':
        fromText(b.content);
        break;
      case 'bulletList':
      case 'orderedList':
        for (const li of b.content ?? []) for (const p of li.content ?? []) walk(p);
        break;
      case 'blockquote':
        for (const p of b.content ?? []) walk(p);
        break;
      default:
        break;
    }
  };

  for (const b of doc.content) walk(b);
  return [...found];
}
