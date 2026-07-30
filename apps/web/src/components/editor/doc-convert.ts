import type { BlockNode, RichDocument, TextNode } from '@grims/shared';

/**
 * Converting between our document format and the editor's internal one.
 *
 * ★ WHY A CONVERSION LAYER AT ALL ★
 *
 * The editing core (ProseMirror, via TipTap) has its own document shape. It is tempting to store
 * that shape directly — it is JSON, it round-trips perfectly, and it would delete this file.
 *
 * It would also make the editor library our database schema. Every stored post would depend on
 * one package's internal format, an upgrade could change what old posts mean, and swapping the
 * editor later would mean migrating every row. Worse for security: the server would be
 * validating a shape defined by someone else's release notes rather than a closed set it owns.
 *
 * So the wire format is OURS — eleven node types, defined in `ssot/04-contracts` — and this
 * translates. The cost is this file. The benefit is that the editor is replaceable and the server
 * validates a format it defines.
 *
 * ★ CONVERSION IS LOSSY IN ONE DIRECTION ONLY ★
 *
 * Editor → document DROPS anything our format does not model. That is deliberate and matches the
 * server, which refuses unknown nodes: if the editor is ever configured with an extension we do
 * not support, the content should not silently reach a post the server will reject. Dropping here
 * means the author sees it disappear while editing, which is a far better signal than a save that
 * fails with "unsupported content" and no clue which part.
 */

/** The editor's node shape, narrowed to what we read. Not exported — nothing else should care. */
interface PmNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

const align = (v: unknown): 'left' | 'center' | 'right' | undefined =>
  v === 'center' || v === 'right' || v === 'left' ? v : undefined;

function toText(nodes: PmNode[] | undefined): TextNode[] {
  return (nodes ?? [])
    .filter((n) => n.type === 'text' && typeof n.text === 'string')
    .map((n) => {
      const marks = (n.marks ?? [])
        .map((m) => {
          switch (m.type) {
            case 'bold':
            case 'italic':
            case 'strike':
            case 'code':
              return { type: m.type } as const;
            case 'link': {
              const href = m.attrs?.['href'];
              return typeof href === 'string' ? ({ type: 'link', href } as const) : null;
            }
            case 'font': {
              /*
               * An ID from the catalogue. Dropped when absent rather than carried as an empty
               * string — a mark meaning "no font" is a mark that renders a span for nothing.
               */
              const font = m.attrs?.['font'];
              return typeof font === 'string' && font !== ''
                ? ({ type: 'font', font } as const)
                : null;
            }
            case 'mention': {
              /*
               * Dropped when the id is missing, rather than saved as a mention of nobody. A mark
               * with no `userId` would pass validation as styling and then notify no one — which
               * looks identical to a working mention to the person who wrote it.
               */
              const userId = m.attrs?.['userId'];
              return typeof userId === 'string' && userId !== ''
                ? ({ type: 'mention', userId } as const)
                : null;
            }
            default:
              // An unmodelled mark is dropped rather than carried — see the note above.
              return null;
          }
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);

      return marks.length === 0
        ? { type: 'text' as const, text: n.text as string }
        : { type: 'text' as const, text: n.text as string, marks };
    })
    /*
     * Empty text runs removed. ProseMirror does not usually produce them, but a paste can, and
     * an empty run with marks would render as `<strong></strong>` — invisible, and enough to make
     * a document look non-empty to the server's substance check.
     */
    .filter((t) => t.text !== '');
}

/** Editor state -> our document. Returns null when there is nothing worth saving. */
export function toDocument(root: PmNode): RichDocument | null {
  const blocks: BlockNode[] = [];

  for (const node of root.content ?? []) {
    switch (node.type) {
      case 'paragraph': {
        const a = align(node.attrs?.['textAlign']);
        blocks.push({
          type: 'paragraph',
          ...(a === undefined || a === 'left' ? {} : { align: a }),
          content: toText(node.content),
        });
        break;
      }
      case 'heading': {
        const raw = node.attrs?.['level'];
        /*
         * Clamped to 2 or 3. The server refuses anything else, and the post's title is the page's
         * h1 — a body that could emit another would compete with it. Clamping rather than dropping
         * because an h4 is clearly still meant to be a heading.
         */
        const level = raw === 3 || raw === 4 || raw === 5 || raw === 6 ? 3 : 2;
        blocks.push({ type: 'heading', level, content: toText(node.content) });
        break;
      }
      case 'bulletList':
      case 'orderedList': {
        blocks.push({
          type: node.type,
          content: (node.content ?? []).map((li) => ({
            type: 'listItem' as const,
            content: (li.content ?? [])
              .filter((p) => p.type === 'paragraph')
              .map((p) => ({ type: 'paragraph' as const, content: toText(p.content) })),
          })),
        });
        break;
      }
      case 'blockquote': {
        blocks.push({
          type: 'blockquote',
          content: (node.content ?? [])
            .filter((p) => p.type === 'paragraph')
            .map((p) => ({ type: 'paragraph' as const, content: toText(p.content) })),
        });
        break;
      }
      case 'codeBlock': {
        blocks.push({
          type: 'codeBlock',
          text: (node.content ?? []).map((t) => t.text ?? '').join(''),
        });
        break;
      }
      case 'horizontalRule':
        blocks.push({ type: 'divider' });
        break;
      case 'squadronImage': {
        const mediaId = node.attrs?.['mediaId'];
        if (typeof mediaId !== 'string' || mediaId === '') break;
        const width = node.attrs?.['widthPercent'];
        const caption = node.attrs?.['caption'];
        blocks.push({
          type: 'image',
          mediaId,
          alt: typeof node.attrs?.['alt'] === 'string' ? (node.attrs['alt'] as string) : '',
          align: align(node.attrs?.['align']) ?? 'center',
          widthPercent: typeof width === 'number' ? width : 100,
          ...(typeof caption === 'string' && caption !== '' ? { caption } : {}),
        });
        break;
      }
      case 'squadronVideo': {
        const videoId = node.attrs?.['videoId'];
        if (typeof videoId !== 'string' || videoId === '') break;
        const title = node.attrs?.['title'];
        blocks.push({
          type: 'youtube',
          videoId,
          ...(typeof title === 'string' && title !== '' ? { title } : {}),
        });
        break;
      }
      default:
        // Unmodelled block. Dropped on purpose — see the header.
        break;
    }
  }

  /*
   * "Nothing worth saving" is decided the same way the server decides it: real text, or at least
   * one block that IS content simply by existing. A screenshot with no words is a legitimate post.
   *
   * Written as a recursive walk rather than a cast over a union of content shapes — the first
   * version cast `b.content` to a hand-written shape and the compiler rejected it, correctly:
   * paragraphs, list items and text runs are three different types and pretending otherwise is
   * how a check ends up silently reading the wrong field.
   */
  const blockText = (b: BlockNode): string => {
    switch (b.type) {
      case 'paragraph':
      case 'heading':
        return (b.content ?? []).map((t) => t.text).join('');
      case 'bulletList':
      case 'orderedList':
        return (b.content ?? []).flatMap((li) => (li.content ?? []).map(blockText)).join('');
      case 'blockquote':
        return (b.content ?? []).map(blockText).join('');
      case 'codeBlock':
        return b.text;
      case 'image':
      case 'youtube':
      case 'divider':
        return '';
    }
  };

  const hasContent =
    blocks.some((b) => b.type === 'image' || b.type === 'youtube' || b.type === 'divider') ||
    blocks.some((b) => blockText(b).trim() !== '');

  return hasContent ? { version: 1, content: blocks } : null;
}

/**
 * Our document -> editor state, so editing starts from exactly what was saved.
 *
 * The inverse must be faithful, unlike the forward direction: a round trip that quietly altered
 * somebody's layout would mean opening a post and saving it again degraded it, which is the kind
 * of bug that destroys trust in an editor.
 */
export function fromDocument(doc: RichDocument): PmNode {
  const marksOf = (t: TextNode): NonNullable<PmNode['marks']> =>
    (t.marks ?? []).map((m): { type: string; attrs?: Record<string, unknown> } =>
      m.type === 'link'
        ? { type: 'link', attrs: { href: m.href } }
        : m.type === 'mention'
          ? { type: 'mention', attrs: { userId: m.userId } }
          : m.type === 'font'
            ? { type: 'font', attrs: { font: m.font } }
            : { type: m.type },
    );

  const textOf = (nodes: readonly TextNode[] | undefined): PmNode[] =>
    (nodes ?? []).map((t): PmNode => ({ type: 'text', text: t.text, marks: marksOf(t) }));

  const blockOf = (b: BlockNode): PmNode => {
    switch (b.type) {
      case 'paragraph':
        return {
          type: 'paragraph',
          attrs: { textAlign: b.align ?? 'left' },
          content: textOf(b.content),
        };
      case 'heading':
        return { type: 'heading', attrs: { level: b.level }, content: textOf(b.content) };
      case 'bulletList':
      case 'orderedList':
        return {
          type: b.type,
          content: (b.content ?? []).map((li) => ({
            type: 'listItem',
            content: (li.content ?? []).map((p) => blockOf(p)),
          })),
        };
      case 'blockquote':
        return { type: 'blockquote', content: (b.content ?? []).map(blockOf) };
      case 'codeBlock':
        // An empty code block must have NO content array at all: ProseMirror rejects a text node
        // with an empty string, and an empty array is not the same as absent.
        return b.text === ''
          ? { type: 'codeBlock' }
          : { type: 'codeBlock', content: [{ type: 'text', text: b.text }] };
      case 'divider':
        return { type: 'horizontalRule' };
      case 'image':
        return {
          type: 'squadronImage',
          attrs: {
            mediaId: b.mediaId,
            alt: b.alt,
            align: b.align,
            widthPercent: b.widthPercent,
            caption: b.caption ?? '',
          },
        };
      case 'youtube':
        return { type: 'squadronVideo', attrs: { videoId: b.videoId, title: b.title ?? '' } };
    }
  };

  return { type: 'doc', content: doc.content.map(blockOf) };
}

/**
 * Pulls a YouTube video id out of whatever a member pasted.
 *
 * ★ WHY THIS IS STRICT ABOUT THE HOST ★
 *
 * A member will paste a full watch URL, a share link, a shortened link, or sometimes just the id.
 * All four should work. What must NOT work is treating any URL with an 11-character path segment
 * as a video — that would let `https://evil.test/aaaaaaaaaaa` become an embed, and the embed is
 * the one place an iframe is allowed to appear.
 *
 * So the host is checked against a fixed list before any id is extracted, and the id is then
 * matched against the exact 11-character alphabet the server demands.
 */
export function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  const ALLOWED = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
  if (!ALLOWED.includes(host)) return null;

  const candidate =
    host === 'youtu.be'
      ? url.pathname.slice(1)
      : (url.searchParams.get('v') ??
        // /embed/<id> and /shorts/<id>
        url.pathname.replace(/^\/(embed|shorts|live)\//, ''));

  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}
