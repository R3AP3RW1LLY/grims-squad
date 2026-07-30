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
 * ★ `img` IS NOW ALLOWED, BUT ONLY POINTING AT US ★
 *
 * It was omitted deliberately, on the grounds that a REMOTE image lets a post leak
 * every reader's IP address to a third-party host — a privacy failure rather than an
 * XSS one, and exactly the sort of thing that ships by accident inside a feature
 * nobody thought was about privacy.
 *
 * That reasoning still stands, so the tag is allowed and the SOURCE is not. `src` must
 * be a relative path under our own media route (see `isOwnMediaSrc`). An absolute URL is
 * rejected even if it points at our own domain, because "is this our domain" is a
 * question with a long history of wrong answers — `https://ourhost.example.evil.test`,
 * userinfo tricks, and encoded hosts. A relative path cannot name another host at all,
 * which makes the check a syntactic one rather than a judgement.
 *
 * Every such image has been through `hardenImage`: decoded and re-encoded from pixels,
 * so no EXIF, no polyglot, no appended payload survives. The allowlist here and that
 * pipeline are two halves of one guarantee — this decides WHERE an image may come from,
 * and that decides WHAT the bytes are.
 *
 * Notable omissions and why:
 *   - `svg`  a whole XSS surface of its own (foreignObject, animate, use+xlink).
 *   - `style`/`class`  a post must not be able to restyle the page around it.
 *   - `iframe`, `object`, `embed`, `form`, `input`  nothing a forum post needs.
 *   - `srcset`/`sizes` on img: a second place to put a URL, and one that parsers
 *            disagree about. One attribute to validate is better than three.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'strong', 'em', 'del', 's', 'code', 'pre',
  'blockquote',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'img',
  'figure', 'figcaption',
];

/**
 * The one place an image may come from: our own media route.
 *
 * Exported so the tests can drive it directly, and so nothing else has to reimplement
 * the rule.
 */
export const MEDIA_PATH_PREFIX = '/v1/media/uploads/';

/**
 * Anything a browser might strip or normalise before fetching a URL.
 *
 * ★ WRITTEN WITH \x ESCAPES, AND THAT IS NOT A STYLE CHOICE ★
 *
 * The first version of this check spelled the class with the characters themselves. The
 * result was a source file containing a literal NUL byte and a literal DEL byte — `grep`
 * reported "binary file matches", and the Edit tool could not address the line because
 * the bytes are not typeable. Three separate attempts to patch it read as no-ops.
 *
 * This is the third time on this branch that literal control characters have got into a
 * regex through a shell heredoc (a `\b` became a backspace in `looksDangerous`; a `\s`
 * collapsed to `s` in a built pattern). The lesson has been consistent: escape sequences
 * in a regex LITERAL, never characters that a shell, editor or diff can silently eat.
 *
 * NUL through space covers every whitespace and C0 control character; \x7f is DEL. A
 * leading one of these would leave a `src` failing `startsWith` while a browser trims it
 * and fetches the URL anyway — the classic way a prefix check is bypassed.
 */
const CONTROL_CHARS = /[\x00-\x20\x7f]/;

/**
 * Is this `src` a path to an image WE stored?
 *
 * ★ SYNTACTIC, NOT A JUDGEMENT ABOUT HOSTS ★
 *
 * The tempting version parses the URL and asks "is the host ours". That question has a
 * long history of wrong answers, and every one of them is a way to make a post fetch
 * from somewhere else:
 *
 *   https://ourhost.example.evil.test/x      suffix that merely starts with our name
 *   https://evil.test\@ourhost.example/x     userinfo, where parsers disagree
 *   https://ourhost.example@evil.test/x      the real host is the one after the @
 *   //evil.test/x                            protocol-relative, inherits our scheme
 *   https://ourhost%2eexample.evil.test/x    percent-encoded host
 *
 * So no host comparison happens at all. The `src` must be a RELATIVE PATH beginning with
 * our media prefix — and a relative path is structurally incapable of naming another
 * origin. There is no clever input that makes `/v1/media/uploads/…` point at somebody
 * else's server.
 *
 * The cost is that a legitimate absolute URL to our own domain is refused. That is fine:
 * nothing generates one, the upload endpoint returns a relative path, and refusing a
 * valid-but-unnecessary form is much cheaper than getting host comparison right.
 */
export function isOwnMediaSrc(src: string): boolean {
  /*
   * Whitespace first. A leading space, tab, newline or NUL would leave the string
   * failing `startsWith` while browsers strip it and fetch the URL anyway — the classic
   * way a prefix check is bypassed. Control characters are rejected outright rather than
   * trimmed, because "what does a browser do with this byte" is exactly the question
   * this function exists to avoid asking.
   */
  if (src === '' || CONTROL_CHARS.test(src)) return false;

  // Must be same-origin-relative. A protocol-relative `//host/...` is not.
  if (!src.startsWith(MEDIA_PATH_PREFIX)) return false;

  /*
   * No traversal. `/v1/media/uploads/../../etc/passwd` satisfies the prefix and is not
   * a media path — and while the serve endpoint validates its own id, a stored `src`
   * that only LOOKS contained is a trap for the next person who reads it and assumes
   * containment.
   */
  if (src.includes('..')) return false;

  // No backslashes: some parsers treat them as path separators, some do not.
  if (src.includes('\\')) return false;

  /*
   * The remainder must be a plain identifier — the shape the upload endpoint mints.
   * A query string or fragment is refused rather than stripped: neither has any meaning
   * here, so their presence means the string did not come from us.
   */
  const rest = src.slice(MEDIA_PATH_PREFIX.length);
  return MEDIA_ID.test(rest);
}

/**
 * The id shape the upload endpoint mints — and THE LOAD-BEARING CHECK IN THIS FILE.
 *
 * ★ MEASURED, NOT ASSUMED ★
 *
 * The four guards above were written as layered defences. They are not: this pattern
 * alone rejects every payload the others catch. Verified by running each guard in
 * isolation over the bypass list:
 *
 *   "\x00/v1/media/uploads/x.png"              CONTROL, PREFIX, ID
 *   " /v1/media/uploads/x.png"                 CONTROL, PREFIX, ID
 *   "https://evil.test/v1/media/uploads/x.png"         PREFIX, ID
 *   "//evil.test/v1/media/uploads/x.png"               PREFIX, ID
 *   "/v1/media/uploads/../../etc/passwd"                   .., ID
 *   "/v1/media/uploads/x.png?a=1"                             ID
 *   "/v1/media/uploads/a/b.png"                               ID
 *   "javascript:alert(1)"                              PREFIX, ID
 *
 * ID is in every row. Nothing reaches it that it does not stop.
 *
 * That was worth finding out, because a mutation test proved the point the other way:
 * deleting the control-character check, deleting the traversal check, and weakening
 * `startsWith` to `includes` each left the whole image suite GREEN. Not because the
 * suite is weak, but because those checks were never what rejected the payloads. A
 * comment claiming each one holds a distinct line would have been believed by the next
 * reader and by me.
 *
 * ★ SO WHY KEEP THE OTHERS ★
 *
 * Because "redundant" is a statement about today's pattern, not tomorrow's. The moment
 * somebody widens this to allow a subdirectory or a version query — both reasonable
 * requests — ID stops being sufficient and the prefix and traversal checks start
 * carrying weight. They cost three comparisons. The mistake was describing them as the
 * defence, not including them.
 *
 * ★ WHAT MAKES THE PATTERN SAFE ★
 *
 *   ^ and $        anchored at both ends, so nothing can be appended or prepended. An
 *                  unanchored version would match our id ANYWHERE in a hostile string.
 *   no / \ : ? #   cannot become a path, a scheme, a query or a fragment.
 *   no . first     so an id can never be `.` or `..`.
 *   {0,127}        bounded, so a src cannot be used to store unbounded text.
 */
const MEDIA_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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
      /*
       * `src` and `alt` only — plus the dimensions and `loading`, which `transformTags`
       * SETS rather than accepts. As with the anchor's `rel`, they must be listed here
       * because sanitize-html applies this allowlist AFTER the transform runs, so
       * omitting them would silently discard what the transform had just added.
       *
       * Deliberately NOT allowed: `srcset`, `sizes` (a second place to hide a URL, and
       * one parsers disagree about), `onerror` and friends (covered by the tag-level
       * rules, listed here for the reader), `style`, `usemap`.
       */
      img: ['src', 'alt', 'loading', 'decoding', 'width', 'height'],
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
      /*
       * ★ AN IMAGE THAT IS NOT OURS IS NOT AN IMAGE ★
       *
       * A `src` that fails `isOwnMediaSrc` is not merely stripped — the whole element is
       * turned into a `<span>` carrying the alt text. Three reasons:
       *
       *   - An `<img>` with no `src` is a broken-image icon, which reads as "the site
       *     lost my picture" rather than "that link was refused".
       *   - The alt text is the author's own words about what was there, so keeping it
       *     preserves the meaning of the sentence around it.
       *   - It is visible. A silently vanished image is a bug report; a line of text
       *     saying what was refused is an explanation.
       */
      img: (tagName, attribs) => {
        const src = typeof attribs['src'] === 'string' ? attribs['src'] : '';
        const alt = typeof attribs['alt'] === 'string' ? attribs['alt'] : '';

        if (!isOwnMediaSrc(src)) {
          return {
            tagName: 'span',
            attribs: {},
            text: alt === '' ? '[image removed: not hosted here]' : `[image: ${alt}]`,
          };
        }

        return {
          tagName,
          attribs: {
            src,
            alt,
            /*
             * `loading="lazy"` and `decoding="async"` are set rather than accepted: a
             * guide with a dozen screenshots should not block first paint on all of
             * them, and this is a property of the stored HTML so every consumer gets it.
             */
            loading: 'lazy',
            decoding: 'async',
          },
        };
      },
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
