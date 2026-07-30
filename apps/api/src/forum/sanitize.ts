import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

/**
 * Turning what a member typed into HTML that is safe to store (INV-035).
 *
 * ★ SANITISED BEFORE STORAGE, NOT AT RENDER TIME ★
 *
 * The invariant is explicit about this, and the reason is that "we escape it on
 * output" holds only for as long as every output path remembers to. There will be
 * more than one: the web page, the Discord bridge, a search index, the RAG
 * pipeline, an email digest. The second consumer is the one that forgets.
 *
 * Storing already-safe HTML means a new consumer inherits the guarantee instead of
 * having to reimplement it.
 *
 * ★ TWO INDEPENDENT LAYERS, ON PURPOSE ★
 *
 *   1. markdown-it with `html: false`. Raw HTML in the source is ESCAPED rather
 *      than passed through, so `<script>` never becomes a tag in the first place.
 *   2. sanitize-html over the result, with an allowlist.
 *
 * Layer 2 is not redundant. It is what catches a markdown construct that produces
 * dangerous output without any raw HTML being involved — `[click](javascript:...)`
 * is valid Markdown and produces a valid anchor, and layer 1 has no objection to
 * it. And if a future edit turns `html` back on, or markdown-it ships a bug, the
 * allowlist still holds.
 *
 * ★ NO HAND-ROLLED SANITISER ★
 *
 * Deliberately not a regex pass of my own. HTML sanitising is a problem with a
 * very long tail — nested encodings, mXSS through mutation, namespace confusion in
 * SVG and MathML — and every hand-written version is defeated eventually. This
 * uses a maintained allowlist library and keeps the allowlist small.
 */

/**
 * The markdown renderer.
 *
 * `html: false` is the load-bearing setting. `linkify` is off: auto-linking bare
 * URLs means the renderer decides what is a link, and it has been a source of
 * parsing surprises — a member who wants a link can write one.
 */
const md = new MarkdownIt('default', {
  html: false,
  linkify: false,
  breaks: true,
  typographer: false,
});

/**
 * What a post may contain.
 *
 * Small on purpose. Every tag here is one somebody asked for by writing Markdown;
 * anything not listed is dropped rather than escaped, because a post full of
 * visible `&lt;div&gt;` is a worse outcome than a post without the div.
 *
 * Notable omissions and why:
 *   - `img`  uploads arrive at P2.3 with their own EXIF and polyglot handling.
 *            Allowing remote images now would let a post leak every reader's IP
 *            to a third-party host, which is a privacy problem rather than an XSS
 *            one and is exactly the kind of thing that ships by accident.
 *   - `svg`  a whole XSS surface of its own (foreignObject, animate, use+xlink).
 *   - `style`/`class`  a post must not be able to restyle the page around it.
 *   - `iframe`, `object`, `embed`, `form`, `input`  nothing a forum post needs.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'strong', 'em', 'del', 's', 'code', 'pre',
  'blockquote',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

/**
 * Protocols a link may use.
 *
 * `javascript:` and `data:` are absent, which is the point. `data:` is excluded
 * even for images: `data:text/html` in an anchor is a same-origin script vector,
 * and allowing the scheme selectively is how the exception becomes the hole.
 */
const ALLOWED_SCHEMES = ['http', 'https', 'mailto'];

export interface Rendered {
  /** Exactly what the member typed. Stored verbatim so an edit starts from their text. */
  readonly bodyMd: string;
  /** Safe HTML, ready to embed without further escaping. */
  readonly bodyHtml: string;
}

/**
 * Renders and sanitises a post body.
 *
 * Throws on an empty result rather than storing a blank post: a body that
 * sanitises down to nothing means everything in it was rejected, and silently
 * storing "" would leave the member looking at an empty post with no explanation.
 */
export function renderPostBody(bodyMd: string): Rendered {
  const source = bodyMd.trim();

  const rawHtml = md.render(source);

  const bodyHtml = sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      /*
       * `rel` and `target` are listed because `transformTags` SETS them — and
       * sanitize-html applies the attribute allowlist AFTER the transform, so
       * omitting them here silently discarded the hardening the transform had
       * just added. The link came out with no `noopener` at all.
       *
       * A member cannot supply either: the transform overwrites whatever arrived.
       */
      a: ['href', 'title', 'rel', 'target'],
      code: ['class'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ALLOWED_SCHEMES,
    // No protocol-relative URLs: `//evil.example` inherits our scheme and reads
    // as a path to anybody skimming the source.
    allowProtocolRelative: false,
    /*
     * Anything not allowed is DISCARDED, tag and content together, for the tags
     * where keeping the text would be worse than losing it. `script` and `style`
     * are the cases that matter: escaping their contents leaves the whole payload
     * sitting visibly in the post.
     */
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
    transformTags: {
      /*
       * Every surviving link is external, in a new tab, with the opener severed.
       * Applied here rather than at render time so it is true of the stored HTML —
       * which is what a second consumer will embed.
       */
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: 'noopener noreferrer nofollow ugc', target: '_blank' },
      }),
    },
  });

  return { bodyMd: source, bodyHtml };
}

/**
 * Does this HTML still contain anything dangerous?
 *
 * ★ A CHECK ON THE CHECKER, NOT A SECOND SANITISER ★
 *
 * It cleans nothing. It answers "did the sanitiser fail", which is a question
 * worth being able to ask out loud. A regex is the wrong tool for CLEANING HTML
 * and a reasonable one for spotting that cleaning did not happen.
 *
 * ★ IT MUST ONLY LOOK AT LIVE MARKUP ★
 *
 * The first version matched `javascript:` and `on…=` anywhere in the string, and
 * false-positived on perfectly safe output — because markdown-it with
 * `html: false` ESCAPES raw HTML rather than removing it, so a member who types
 * `<div onclick="alert(1)">` gets `&lt;div onclick="alert(1)"&gt;` as inert TEXT.
 * That is correct and safe: it is not a tag, it cannot execute, and it is what
 * somebody who typed it should see.
 *
 * A checker that called that dangerous would have to be silenced, and a silenced
 * checker is worse than none. So every pattern below requires TAG CONTEXT — an
 * unescaped `<` — which is the only way any of it becomes live.
 */
/**
 * Elements that are dangerous the moment they are LIVE.
 *
 * ★ A LITERAL, BECAUSE A BUILT STRING LOST ITS ESCAPES TWICE ★
 *
 * This pattern previously sat inline as a literal and contained a real BACKSPACE
 * byte (0x08): written through a shell heredoc, an intended word-boundary escape was
 * interpreted as the backspace escape. The regex then required a backspace after
 * the tag name, matched nothing, and `looksDangerous` declared every payload safe
 * — while reading perfectly correctly in every editor and diff.
 *
 * Its own self-test caught it, which is the argument for having one.
 *
 * The trailing class is the word boundary, spelled out: a tag name must be
 * followed by whitespace, `>` or `/`, so `<scriptural>` is not a script tag.
 */
/**
 * ★ A LITERAL, NOT `new RegExp(string)` — AND THAT IS THE SECOND BUG HERE ★
 *
 * The string version read `'<\s*(' + … + ')[\s>/]'`, and in a JS string `\s` is
 * not an escape — it collapses to a bare `s`. So the compiled pattern meant "`<`
 * followed by any number of the LETTER s", and `<iframe src=x>` did not match
 * because the space after the tag name was never in the character class.
 *
 * `<script>` matched anyway, by luck: with `s*` taking zero characters the
 * alternation still lined up and `>` happened to be in `[s>/]`. One payload
 * passing and another failing, from the same broken pattern.
 *
 * A regex literal has no string-escaping layer to lose, so `\s` means what it
 * says. Written out rather than composed, because composition is what invited the
 * escaping in the first place.
 *
 * The trailing class is the word boundary spelled out: a tag name must be followed
 * by whitespace, `>` or `/`, so `<scriptural>` is not a script tag.
 */
const TAG_PATTERN =
  /<\s*(script|iframe|svg|object|embed|form|noscript|base|meta|link)[\s>/]/;

export function looksDangerous(html: string): boolean {
  const h = html.toLowerCase();

  // A real element, not the escaped text of one. `&lt;script` does not match.
  if (TAG_PATTERN.test(h)) return true;

  // An on* handler INSIDE a tag. Requires an unescaped `<` before it.
  if (/<[^>]*\son[a-z]+\s*=/.test(h)) return true;

  // A dangerous scheme in an attribute that navigates or loads.
  if (/<[^>]*(href|src|action|formaction|xlink:href)\s*=\s*["']?\s*javascript\s*:/.test(h)) {
    return true;
  }
  if (/<[^>]*(href|src|action|formaction)\s*=\s*["']?\s*data\s*:\s*text\/html/.test(h)) {
    return true;
  }

  return false;
}
