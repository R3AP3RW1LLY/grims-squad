import { describe, it, expect } from 'vitest';
import { BANNER, signatureBBCode, signatureHtml, signatureMarkdown } from './forum-signature.js';

/**
 * Markup handed to members to paste on OTHER forums.
 *
 * ★ WHY THIS IS TESTED LIKE AN OUTPUT ENCODER, BECAUSE IT IS ONE ★
 *
 * Everything here ends up inside somebody else's page, rendered by somebody else's parser, with
 * none of our sanitiser or our CSP in front of it. We cannot make another forum safe — but we can
 * refuse to be the source of the thing that breaks it, and a signature is pasted once and then
 * rendered on every post that member writes there.
 *
 * The values are already constrained upstream: the banner URL is built by us from a media id, and
 * the link passed an https host allowlist. These tests exist because "already constrained" is a
 * property of today's callers, and this function will outlive them.
 */

const share = {
  bannerUrl: 'https://45-63-35-93.sslip.io/v1/media/uploads/abc',
  link: 'https://inara.cz/elite/cmdr/1/',
  tagline: 'o7 — Blood Brothers of Alrai',
};

describe('signature BBCode', () => {
  it('wraps the banner in a link when there is one', () => {
    const out = signatureBBCode(share);
    expect(out).toContain('[url=https://inara.cz/elite/cmdr/1/]');
    expect(out).toContain('[img]https://45-63-35-93.sslip.io/v1/media/uploads/abc[/img]');
    expect(out).toContain('[/url]');
  });

  it('emits a bare image when there is nowhere to go', () => {
    /*
     * `[url=]` with an empty target renders as a dead link on some forums and as literal text on
     * others. Neither is what anybody wanted, so the tag is omitted rather than emptied.
     */
    const out = signatureBBCode({ ...share, link: null });
    expect(out).not.toContain('[url');
    expect(out.startsWith('[img]')).toBe(true);
  });

  it('puts the tagline below the banner, as it reads on our own forum', () => {
    const out = signatureBBCode(share);
    const lines = out.split('\n');
    expect(lines[0]).toContain('[img]');
    expect(lines[1]).toBe('o7 — Blood Brothers of Alrai');
  });

  it('omits the tagline line entirely when there is none', () => {
    // A trailing blank line in a signature box is a blank line on every post they write.
    expect(signatureBBCode({ ...share, tagline: null })).not.toContain('\n');
  });

  describe('MANDATORY: cannot be made to emit extra tags', () => {
    it('strips brackets from the link', () => {
      /*
       * THE ONE THIS EXISTS FOR. A `]` inside the attribute closes `[url=` early and everything
       * after it becomes markup on somebody else's forum — BBCode has no escape syntax, so the
       * character is removed rather than escaped.
       */
      const out = signatureBBCode({
        ...share,
        link: 'https://inara.cz/][url=https://evil.test]click',
      });
      expect(out.match(/\[url=/g)).toHaveLength(1);
      expect(out).not.toContain('evil.test]click');
    });

    it('strips brackets from the banner URL', () => {
      const out = signatureBBCode({
        ...share,
        bannerUrl: 'https://x.test/a[/img][url=https://evil.test]',
      });
      expect(out.match(/\[img\]/g)).toHaveLength(1);
      expect(out.match(/\[\/img\]/g)).toHaveLength(1);
    });

    it('strips brackets from the tagline', () => {
      const out = signatureBBCode({ ...share, tagline: '[url=https://evil.test]free ships[/url]' });
      expect(out).not.toContain('[url=https://evil.test]');
    });

    it('MANDATORY: strips newlines, which split a tag in half', () => {
      // A linebreak inside `[url=...]` breaks the tag and the rest renders as literal text.
      const out = signatureBBCode({ ...share, link: 'https://inara.cz/\n[img]x[/img]' });
      expect(out.split('\n')[0]).toContain('[url=');
      expect(out).not.toContain('[img]x[/img]');
    });
  });
});

describe('signature Markdown', () => {
  it('nests the image inside the link', () => {
    const out = signatureMarkdown(share);
    expect(out).toContain('](https://inara.cz/elite/cmdr/1/)');
    expect(out).toContain('![');
  });

  it('MANDATORY: strips brackets from the alt text', () => {
    // An unescaped `]` in alt text closes the image early and the rest leaks out as text.
    const out = signatureMarkdown({ ...share, tagline: 'ships ](https://evil.test) free' });
    const altText = out.slice(out.indexOf('![') + 2, out.indexOf(']('));
    expect(altText).not.toContain(']');
    expect(altText).not.toContain('[');
  });

  it('MANDATORY: escapes brackets in the tagline line as well', () => {
    /*
     * The first version escaped the alt text and appended the tagline raw, so a tagline containing
     * link syntax stayed live and became a real link on the target forum. Not a security hole —
     * it is their own signature — but a surprise, and the point of generating this is that what
     * they see here is what they get there.
     */
    const out = signatureMarkdown({ ...share, tagline: '[free ships](https://evil.test)' });
    const taglineLine = out.split('\n').at(-1) ?? '';
    expect(taglineLine).toContain('\\[');
    expect(taglineLine).not.toMatch(/(?<!\\)\[free ships\]\(/);
  });

  it('emits a bare image when there is no link', () => {
    const out = signatureMarkdown({ ...share, link: null });
    expect(out.startsWith('![')).toBe(true);
  });
});

describe('signature HTML', () => {
  it('MANDATORY: escapes quotes so an attribute cannot be broken out of', () => {
    /*
     * `"` is the whole attack in an HTML attribute: close the quote, open an event handler. Escaped
     * rather than stripped, because unlike BBCode, HTML has a real escape syntax.
     */
    const out = signatureHtml({
      ...share,
      link: 'https://inara.cz/" onclick="alert(1)',
    });
    expect(out).not.toContain('onclick="alert(1)"');
    expect(out).toContain('&quot;');
  });

  it('MANDATORY: escapes angle brackets in the alt text', () => {
    const out = signatureHtml({ ...share, tagline: '<script>alert(1)</script>' });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('carries rel=noopener on the link', () => {
    // Markup we hand somebody to paste on a site we do not control. Shipping a link without it
    // teaches the habit by example.
    expect(signatureHtml(share)).toContain('rel="noopener noreferrer"');
  });

  it('states the banner dimensions so the target page does not reflow', () => {
    const out = signatureHtml(share);
    /*
     * Against BANNER, not literals. This spec once pinned height="120" — the pre-160 size — and
     * dutifully held the HTML snippet to squashing every published banner by a quarter. The claim
     * worth pinning is "the snippet states the REAL dimensions", whatever the banner grows to.
     */
    expect(out).toContain(`width="${BANNER.width}"`);
    expect(out).toContain(`height="${BANNER.height}"`);
  });
});
