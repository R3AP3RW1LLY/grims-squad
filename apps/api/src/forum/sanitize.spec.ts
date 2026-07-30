import { describe, it, expect } from 'vitest';
import { renderPostBody, looksDangerous } from './sanitize.js';

/**
 * The MANDATORY XSS suite (INV-035, P2.2).
 *
 * The acceptance criterion names the classes by hand — "script tags, event
 * handlers, javascript: URLs, data: URLs, SVG payloads and nested-encoding
 * attacks" — so each is tested by name rather than folded into one happy case.
 *
 * ★ THESE ASSERT ON THE STORED HTML, NOT ON A RENDER ★
 *
 * The invariant requires sanitising BEFORE STORAGE, because "we escape on output"
 * holds only while every output path remembers to — and there will be several: the
 * page, the Discord bridge, search, RAG, a digest. So every assertion here is
 * about what `renderPostBody` would put in the database.
 */

/** The stored HTML for a body, which is what any consumer would embed. */
const html = (md: string): string => renderPostBody(md).bodyHtml;

describe('script tags', () => {
  it('MANDATORY @INV-035: a raw script tag never survives', () => {
    const out = html('<script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(looksDangerous(out)).toBe(false);
  });

  it('renders raw HTML as INERT TEXT, which is the safe and honest outcome', () => {
    /*
     * ★ WHAT ACTUALLY HAPPENS, AND WHY IT IS RIGHT ★
     *
     * My first version of this test asserted the payload text was ABSENT. It is
     * not: markdown-it with `html: false` ESCAPES raw HTML rather than removing
     * it, so the member sees `<script>alert(document.cookie)</script>` as literal
     * text in their post.
     *
     * That is correct on both counts. It cannot execute — `&lt;script&gt;` is not
     * a tag — and it is what somebody who typed those characters should see. A
     * sanitiser that silently ate their text would be lying to them about what
     * they posted.
     *
     * So the assertion is about the LIVE property: no element, no execution.
     */
    const out = html('<script>alert(document.cookie)</script>');

    expect(out).not.toMatch(/<\s*script/i);   // no element
    expect(out).toContain('&lt;script&gt;');  // escaped text, visible to the author
    expect(looksDangerous(out)).toBe(false);
  });

  it('catches a script tag hidden in mixed case and whitespace', () => {
    for (const payload of ['<ScRiPt>alert(1)</ScRiPt>', '< script >alert(1)</script>', '<script\n>alert(1)</script>']) {
      expect(looksDangerous(html(payload)), payload).toBe(false);
    }
  });
});

describe('event handlers', () => {
  it('MANDATORY @INV-035: an inline handler never becomes live', () => {
    // Escaped to text by layer 1, so there is no tag for the handler to attach
    // to. Asserted on the live property rather than on the substring, for the
    // reason spelled out in the script-tag case above.
    const out = html('<div onclick="alert(1)">click</div>');
    expect(out).not.toMatch(/<\s*div/i);
    expect(looksDangerous(out)).toBe(false);
  });

  it('MANDATORY @INV-035: a handler on a MARKDOWN-produced link cannot exist', () => {
    /*
     * The interesting case. Raw `<a onmouseover=…>` is escaped to text, so the
     * attribute allowlist is never even reached — which means the test above
     * proves layer 1 and this one has to reach layer 2 differently.
     *
     * A Markdown link produces a REAL anchor, and the allowlist decides what may
     * ride on it: href and title only. There is no Markdown syntax that emits an
     * event handler, which is precisely why the allowlist is the backstop rather
     * than the front line.
     */
    const out = html('[x](https://example.com "t")');
    expect(out).toMatch(/<a /);
    expect(out).not.toMatch(/\son[a-z]+=/i);
    expect(looksDangerous(out)).toBe(false);
  });

  it('no on* variant survives as live markup, hand-listed or not', () => {
    for (const handler of ['onerror', 'onload', 'onfocus', 'onanimationend', 'onpointerdown']) {
      const out = html(`<a href="https://example.com" ${handler}="alert(1)">x</a>`);
      expect(looksDangerous(out), handler).toBe(false);
      expect(out, handler).not.toMatch(/<a /);
    }
  });
});

describe('javascript: URLs', () => {
  it('MANDATORY @INV-035: a javascript: link is neutralised', () => {
    /*
     * ★ THE CASE THE MARKDOWN LAYER CANNOT CATCH ★
     *
     * `[x](javascript:alert(1))` is valid Markdown containing no raw HTML at all,
     * so `html: false` has no objection to it. This is why the allowlist exists as
     * a second layer rather than as belt-and-braces.
     */
    const out = html('[click me](javascript:alert(1))');

    /*
     * markdown-it refuses the scheme outright and emits the literal text rather
     * than an anchor — so there is no link at all, which is stronger than a link
     * with a stripped href. Asserted as "no live anchor carrying it".
     */
    expect(out).not.toMatch(/<a [^>]*href/i);
    expect(looksDangerous(out)).toBe(false);
  });

  it('catches the obfuscated spellings', () => {
    for (const payload of [
      '[x](JaVaScRiPt:alert(1))',
      '[x](java\tscript:alert(1))',
      '[x](  javascript:alert(1))',
    ]) {
      const out = html(payload);
      expect(looksDangerous(out), payload).toBe(false);
      expect(out, payload).not.toMatch(/<a [^>]*href/i);
    }
  });
});

describe('data: URLs', () => {
  it('MANDATORY @INV-035: data:text/html is refused', () => {
    // A same-origin script vector when followed from an anchor.
    const out = html('[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)');
    expect(out).not.toMatch(/<a [^>]*href/i);
    expect(looksDangerous(out)).toBe(false);
  });

  it('refuses data: even for something that looks like an image', () => {
    // Allowing the scheme selectively is how the exception becomes the hole.
    const out = html('[x](data:image/svg+xml,<svg onload=alert(1)>)');
    expect(out).not.toMatch(/<a [^>]*href/i);
    expect(looksDangerous(out)).toBe(false);
  });
});

describe('SVG payloads', () => {
  it('MANDATORY @INV-035: svg is dropped entirely', () => {
    const out = html('<svg><script>alert(1)</script></svg>');
    expect(out).not.toMatch(/<\s*svg/i);
    expect(looksDangerous(out)).toBe(false);
  });

  it('drops the animate and use vectors too', () => {
    for (const payload of [
      '<svg><animate onbegin="alert(1)" attributeName="x"/></svg>',
      '<svg><use href="data:image/svg+xml,&lt;svg id=&quot;x&quot;&gt;"/></svg>',
      '<svg><foreignObject><body><script>alert(1)</script></body></foreignObject></svg>',
    ]) {
      expect(looksDangerous(html(payload)), payload).toBe(false);
    }
  });
});

describe('nested and double encoding', () => {
  it('MANDATORY @INV-035: a double-encoded script tag stays inert', () => {
    /*
     * The attack this defends against is a consumer that decodes once more than
     * the sanitiser did. Storing already-safe HTML is what makes it moot: nothing
     * downstream is supposed to decode the stored value at all.
     */
    for (const payload of [
      '&lt;script&gt;alert(1)&lt;/script&gt;',
      '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;',
      '%3Cscript%3Ealert(1)%3C/script%3E',
      '&#60;script&#62;alert(1)&#60;/script&#62;',
    ]) {
      const out = html(payload);
      expect(looksDangerous(out), payload).toBe(false);
      // And critically: no live tag, however many decodings deep it started.
      expect(out, payload).not.toMatch(/<\s*script/i);
    }
  });

  it('does not itself introduce a decoding step', () => {
    // If the output contained a raw `<` from an escaped source, a second decode
    // downstream would produce a tag. It must stay escaped.
    const out = html('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toMatch(/<\s*img/i);
    expect(looksDangerous(out)).toBe(false);
  });
});

describe('other tags nobody needs in a post', () => {
  it('drops iframe, object, embed and form', () => {
    for (const payload of [
      '<iframe src="https://evil.example"></iframe>',
      '<object data="x"></object>',
      '<embed src="x">',
      '<form action="/x"><input name="y"></form>',
    ]) {
      expect(looksDangerous(html(payload)), payload).toBe(false);
    }
  });

  it('drops style, which could restyle the page around the post', () => {
    const out = html('<style>body{display:none}</style>');
    // Escaped to text by layer 1, so it cannot apply. Visible to the author as
    // what they typed, which is the honest outcome.
    expect(out).not.toMatch(/<\s*style/i);
    expect(looksDangerous(out)).toBe(false);
  });

  it('does not allow images yet — uploads arrive at P2.3', () => {
    /*
     * A remote image would leak every reader's IP to a third-party host. That is a
     * privacy problem rather than an XSS one, and exactly the sort of thing that
     * ships by accident inside a security change.
     */
    const out = html('![alt](https://evil.example/track.png)');
    expect(out).not.toMatch(/<\s*img/i);
  });
});

describe('what a member actually wanted to write still works', () => {
  it('keeps ordinary formatting', () => {
    const out = html('**bold** and _italic_ and `code`');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<code>code</code>');
  });

  it('keeps lists, quotes, headings and tables', () => {
    expect(html('- one\n- two')).toContain('<ul>');
    expect(html('> quoted')).toContain('<blockquote>');
    expect(html('## Heading')).toContain('<h2>');
    expect(html('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('<table>');
  });

  it('keeps a normal https link, and hardens it', () => {
    const out = html('[Inara](https://inara.cz)');
    expect(out).toContain('href="https://inara.cz"');
    // Forced rather than allowed through: a member-supplied `rel` could clear
    // noopener, which is what stops the opened page reaching window.opener.
    expect(out).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(out).toContain('target="_blank"');
  });

  it('keeps a mailto link', () => {
    expect(html('[mail](mailto:a@b.example)')).toContain('mailto:a@b.example');
  });

  it('refuses a protocol-relative URL', () => {
    // `//evil.example` inherits our scheme and reads as a path when skimming.
    expect(html('[x](//evil.example)')).not.toContain('evil.example');
  });

  it('stores the member’s original Markdown verbatim, so an edit starts from their text', () => {
    const source = '**bold**\n\n- a\n- b';
    expect(renderPostBody(`  ${source}  `).bodyMd).toBe(source);
  });
});

describe('looksDangerous', () => {
  /*
   * The check on the checker. Without this a broken regex would make every
   * assertion above pass by reporting everything as safe.
   */
  it('detects each class it claims to', () => {
    for (const bad of [
      '<script>x</script>',
      '<iframe src=x>',
      '<svg>',
      '<object>',
      '<embed>',
      '<form>',
      '<a onclick="x">',
      '<a href="javascript:x">',
      '<a href="data:text/html,x">',
    ]) {
      expect(looksDangerous(bad), bad).toBe(true);
    }
  });

  it('does not fire on safe output', () => {
    expect(looksDangerous('<p><strong>hi</strong></p>')).toBe(false);
    // The word "javascript" in prose is not a javascript: URL.
    expect(looksDangerous('<p>I write javascript for a living</p>')).toBe(false);
  });
});
