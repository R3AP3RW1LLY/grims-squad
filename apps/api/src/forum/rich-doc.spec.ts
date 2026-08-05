import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@grims/shared';
import { validateDocument, renderDocument, documentToText } from './rich-doc.js';

/**
 * The rich document boundary (INV-035, P2.3).
 *
 * ★ WHY THIS SUITE IS THE ONE THAT MATTERS ★
 *
 * Owner chose that EVERY member gets the rich editor, not just officers. So the most capable
 * input surface in the application is open to 107 people, and this file is what stands between
 * that and a page.
 *
 * The design inverts the usual problem: the server never accepts HTML, only a node tree, and
 * generates the HTML itself. That means the interesting tests are not "can this XSS payload get
 * through the sanitiser" but "can anything that is not one of eleven known shapes get STORED at
 * all". Both are covered below, in that order of emphasis.
 */

const doc = (...content: unknown[]) => ({ version: 1, content });
const para = (text: string, marks?: unknown[]) => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(marks === undefined ? {} : { marks }) }],
});
const UUID = '11111111-2222-4333-8444-555555555555';

/** Validates then renders, which is the only path a document can take to a page. */
const html = (input: unknown): string => renderDocument(validateDocument(input));

describe('nothing outside the known node types can be stored', () => {
  it('MANDATORY: an unknown block type is REFUSED, not dropped', () => {
    /*
     * Refusing rather than silently discarding. Dropping would mean a member loses part of a
     * post with no explanation, and an editor bug would produce quietly truncated content
     * nobody notices for weeks.
     */
    expect(() => validateDocument(doc({ type: 'script', text: 'alert(1)' }))).toThrowError(
      /Unsupported content/,
    );
    expect(() => validateDocument(doc({ type: 'iframe' }))).toThrowError(/Unsupported content/);
    expect(() => validateDocument(doc({ type: 'html', value: '<script>x</script>' }))).toThrow();
  });

  it('MANDATORY: there is no node type that can carry raw HTML', () => {
    /*
     * The structural claim. Every accepted type is enumerated in the validator's switch, and
     * none of them has a field whose contents reach the output unescaped — so a document has
     * nowhere to PUT markup, which is stronger than sanitising markup well.
     */
    for (const attempt of [
      { type: 'paragraph', content: [{ type: 'html', value: '<script>x</script>' }] },
      { type: 'paragraph', content: '<script>x</script>' },
      { type: 'codeBlock', text: '<script>x</script>' },
    ]) {
      const out = (() => {
        try {
          return html(doc(attempt));
        } catch {
          return 'REFUSED';
        }
      })();
      expect(out, JSON.stringify(attempt)).not.toMatch(/<script/i);
    }
  });

  it('MANDATORY: an unknown MARK is refused', () => {
    expect(() => validateDocument(doc(para('x', [{ type: 'onclick' }])))).toThrowError(
      /Unsupported text style/,
    );
  });

  it('refuses a document with the wrong version', () => {
    // A renderer meeting a version it does not know must refuse rather than half-understand it.
    expect(() => validateDocument({ version: 2, content: [para('x')] })).toThrowError(
      /unsupported editor version/,
    );
    expect(() => validateDocument({ content: [para('x')] })).toThrow();
  });
});

describe('text is escaped exactly once, in one place', () => {
  it('MANDATORY: angle brackets in text become entities', () => {
    const out = html(doc(para('<script>alert(1)</script>')));

    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('&lt;script&gt;');
  });

  it('MANDATORY: quotes and ampersands in text and attributes are escaped', () => {
    const out = html(
      doc({
        type: 'image',
        mediaId: UUID,
        alt: 'a " onerror=alert(1) & <b>',
        align: 'center',
        widthPercent: 100,
      }),
    );

    /*
     * ★ ASSERTING THE LIVE PROPERTY, NOT THE ABSENCE OF A SUBSTRING ★
     *
     * My first assertion here was `not.toMatch(/onerror=alert/)` and it failed — correctly. The
     * literal characters ARE present, inside an escaped attribute value, and that is the right
     * outcome: a member who types `onerror=alert(1)` into an image description should see those
     * characters back.
     *
     * What must be true is that the quote before them is escaped, so the string cannot close the
     * `alt` attribute and start a new one. That is the property, and it is what is checked.
     */
    expect(out).not.toMatch(/"\s+onerror=/);
    expect(out).toContain('&quot;');
    expect(out).toContain('&amp;');
    expect(out).toContain('&lt;b&gt;');
  });

  it('does not double-escape an already-escaped sequence', () => {
    // A member who literally types `&amp;` should see `&amp;`, not `&amp;amp;`.
    const out = html(doc(para('&amp;')));
    expect(out).toContain('&amp;amp;');
  });
});

describe('links', () => {
  it('MANDATORY: javascript: and data: are refused', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(() => validateDocument(doc(para('x', [{ type: 'link', href }]))), href).toThrowError(
        /cannot allow/,
      );
    }
  });

  it('MANDATORY: a surviving link is hardened, and the author cannot change that', () => {
    /*
     * `rel` and `target` are emitted by the renderer, not carried in the document — so unlike
     * an HTML pipeline there is no attribute a member could supply to clear `noopener`.
     */
    const out = html(doc(para('Inara', [{ type: 'link', href: 'https://inara.cz' }])));

    expect(out).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(out).toContain('target="_blank"');
  });

  it('allows http, https, mailto and a same-site relative path', () => {
    for (const href of ['https://inara.cz', 'http://example.test', 'mailto:a@b.example', '/guides']) {
      expect(() => validateDocument(doc(para('x', [{ type: 'link', href }]))), href).not.toThrow();
    }
  });

  it('MANDATORY: refuses a protocol-relative URL', () => {
    // `//evil.test` inherits our scheme and reads as a path when skimmed.
    expect(() => validateDocument(doc(para('x', [{ type: 'link', href: '//evil.test' }])))).toThrow();
  });
});

describe('images cannot reference another host', () => {
  it('MANDATORY: the node has NO url field — only our upload id', () => {
    /*
     * ★ THE PRIVACY RULE MADE STRUCTURAL ★
     *
     * For Markdown posts, `isOwnMediaSrc` CHECKS that a src is ours. Here there is no field in
     * which a foreign address could be written, so the check is unnecessary: the renderer
     * builds the path from a validated uuid.
     */
    const out = html(
      doc({ type: 'image', mediaId: UUID, alt: 'shot', align: 'center', widthPercent: 100 }),
    );

    expect(out).toContain(`src="/v1/media/uploads/${UUID}"`);
    expect(out).not.toContain('http');
  });

  it('MANDATORY: a non-uuid mediaId is refused', () => {
    for (const mediaId of [
      'https://evil.test/x.png',
      '../../etc/passwd',
      'not-a-uuid',
      '',
      `${UUID}/../../evil`,
    ]) {
      expect(
        () =>
          validateDocument(
            doc({ type: 'image', mediaId, alt: '', align: 'center', widthPercent: 100 }),
          ),
        mediaId,
      ).toThrowError(/not one of our uploads/);
    }
  });

  it('CLAMPS an out-of-range width rather than refusing the post', () => {
    /*
     * The one place this file repairs instead of refusing, deliberately: an out-of-range slider
     * value is a UI bug, and rejecting somebody's whole post over it would be obnoxious.
     */
    const wide = html(
      doc({ type: 'image', mediaId: UUID, alt: '', align: 'left', widthPercent: 5000 }),
    );
    const narrow = html(
      doc({ type: 'image', mediaId: UUID, alt: '', align: 'left', widthPercent: -20 }),
    );

    expect(wide).toContain('width:100%');
    expect(narrow).toContain('width:25%');
  });

  it('MANDATORY: a bogus alignment falls back rather than reaching the class attribute', () => {
    // An unchecked align would put member text straight into a class name.
    const out = html(
      doc({
        type: 'image',
        mediaId: UUID,
        alt: '',
        align: 'center" onload="alert(1)',
        widthPercent: 100,
      }),
    );
    expect(out).not.toMatch(/onload/);
    expect(out).toContain('doc-center');
  });
});

describe('YouTube embeds are click-to-play', () => {
  it('MANDATORY: the stored HTML contains NO iframe', () => {
    /*
     * ★ THE POINT OF THE WHOLE DESIGN ★
     *
     * An always-embedded player reports every reader of the page to Google whether they watch
     * or not, and this squadron includes minors (D15). So the stored markup is a placeholder,
     * and the iframe is created by a click.
     */
    const out = html(doc({ type: 'youtube', videoId: 'dQw4w9WgXcQ', title: 'A video' }));

    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toContain('youtube.com');
    expect(out).not.toContain('youtu.be');
    // And it does carry what the client needs to build one on demand.
    expect(out).toContain('data-youtube="dQw4w9WgXcQ"');
  });

  it('MANDATORY: does not fetch a thumbnail from Google either', () => {
    /*
     * `img.youtube.com` would leak the reader to Google on PAGE LOAD, which is exactly what
     * click-to-play exists to prevent. Easy to add by accident while making it look nicer.
     */
    const out = html(doc({ type: 'youtube', videoId: 'dQw4w9WgXcQ' }));
    expect(out).not.toContain('ytimg');
    expect(out).not.toContain('img.youtube');
  });

  it('MANDATORY: only an 11-character video id is accepted', () => {
    for (const videoId of [
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      '../../etc',
      'dQw4w9WgXcQ" onload="alert(1)',
      'short',
      '',
    ]) {
      expect(() => validateDocument(doc({ type: 'youtube', videoId })), videoId).toThrowError(
        /YouTube video link/,
      );
    }
  });
});

describe('resource limits', () => {
  it('MANDATORY: refuses a document with too many blocks', () => {
    const many = Array.from({ length: 401 }, () => para('x'));
    expect(() => validateDocument({ version: 1, content: many })).toThrowError(/too many blocks/);
  });

  it('MANDATORY: refuses too much text', () => {
    const huge = para('a'.repeat(90_000));
    expect(() => validateDocument(doc(huge))).toThrowError(/too long/);
  });

  it('MANDATORY: refuses too many images and too many embeds', () => {
    const imgs = Array.from({ length: 41 }, () => ({
      type: 'image',
      mediaId: UUID,
      alt: '',
      align: 'center',
      widthPercent: 100,
    }));
    expect(() => validateDocument({ version: 1, content: imgs })).toThrowError(/images/);

    const vids = Array.from({ length: 11 }, () => ({ type: 'youtube', videoId: 'dQw4w9WgXcQ' }));
    expect(() => validateDocument({ version: 1, content: vids })).toThrowError(/videos/);
  });

  it('MANDATORY: refuses deep nesting', () => {
    // The type graph bounds this, but a hostile payload does not respect the type graph.
    let nested: unknown = para('x');
    for (let i = 0; i < 8; i++) nested = { type: 'blockquote', content: [nested] };
    expect(() => validateDocument(doc(nested))).toThrow();
  });

  it('refuses an empty document, and one of only empty paragraphs', () => {
    expect(() => validateDocument({ version: 1, content: [] })).toThrowError(/Write something/);
    expect(() =>
      validateDocument({ version: 1, content: [para(''), para('   '), para('\n')] }),
    ).toThrowError(/Write something/);
  });

  it('an image ALONE is a valid post', () => {
    // A screenshot with no words is a legitimate reply, and treating it as empty would be wrong.
    expect(() =>
      validateDocument(
        doc({ type: 'image', mediaId: UUID, alt: 'the error', align: 'center', widthPercent: 100 }),
      ),
    ).not.toThrow();
  });
});

describe('what a member actually wrote still works', () => {
  it('renders headings, lists, quotes, code and a divider', () => {
    const out = html(
      doc(
        { type: 'heading', level: 2, content: [{ type: 'text', text: 'Step 1' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [para('first')] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [para('one')] }] },
        { type: 'blockquote', content: [para('quoted')] },
        { type: 'codeBlock', text: 'pnpm dev' },
        { type: 'divider' },
      ),
    );

    expect(out).toContain('<h2>Step 1</h2>');
    expect(out).toContain('<ul><li><p>first</p></li></ul>');
    expect(out).toContain('<ol><li><p>one</p></li></ol>');
    expect(out).toContain('<blockquote><p>quoted</p></blockquote>');
    expect(out).toContain('<pre><code>pnpm dev</code></pre>');
    expect(out).toContain('<hr />');
  });

  it('nests marks so a styled link is well formed', () => {
    /*
     * Order matters for validity: `code` closest to the text, the link outermost so the whole
     * run is clickable. Applied in a fixed order rather than the order the editor happened to
     * list them, which is what stops `<a><strong></a></strong>`.
     */
    const out = html(
      doc(
        para('click', [
          { type: 'bold' },
          { type: 'italic' },
          { type: 'link', href: 'https://inara.cz' },
        ]),
      ),
    );

    expect(out).toBe(
      '<p><a href="https://inara.cz" rel="noopener noreferrer nofollow ugc" target="_blank"><strong><em>click</em></strong></a></p>',
    );
  });

  it('keeps paragraph alignment', () => {
    expect(html(doc({ ...para('centred'), align: 'center' }))).toContain('class="doc-center"');
  });

  it('renders a captioned, aligned, resized image', () => {
    const out = html(
      doc({
        type: 'image',
        mediaId: UUID,
        alt: 'the API tab',
        align: 'right',
        widthPercent: 50,
        caption: 'Where the key lives',
      }),
    );

    expect(out).toContain('doc-figure doc-right');
    expect(out).toContain('width:50%');
    expect(out).toContain('<figcaption>Where the key lives</figcaption>');
    expect(out).toContain('loading="lazy"');
  });
});

describe('documentToText, for search and previews', () => {
  it('includes image alt text, so a guide of screenshots is still findable', () => {
    const text = documentToText(
      validateDocument(
        doc(
          para('Follow these steps'),
          { type: 'image', mediaId: UUID, alt: 'the Inara API tab', align: 'center', widthPercent: 100 },
        ),
      ),
    );

    expect(text).toContain('Follow these steps');
    expect(text).toContain('the Inara API tab');
  });

  it('does not leak markup into the indexed text', () => {
    const text = documentToText(validateDocument(doc(para('<b>bold</b>'))));
    // The raw characters the member typed, not entities and not tags.
    expect(text).toBe('<b>bold</b>');
  });
});

describe('renderDocument cannot be called on unvalidated input', () => {
  it('MANDATORY: the type system enforces validation first', async () => {
    /*
     * `renderDocument` takes `RichDocument`, a type only obtainable from `validateDocument`. So
     * rendering something unchecked is a compile error rather than a thing to remember — the
     * same trick as `AclBoundClient`.
     *
     * Asserted structurally, because a passing runtime test cannot demonstrate a compile-time
     * property.
     */
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./rich-doc.ts', import.meta.url), 'utf8');

    expect(src).toMatch(/export function renderDocument\(doc: RichDocument\)/);
    expect(src).not.toMatch(/export function renderDocument\(doc: unknown\)/);
  });
});

describe('the error messages are for a member, not a developer', () => {
  it('says what to do about it', () => {
    try {
      validateDocument({ version: 1, content: [] });
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe(ErrorCode.VALIDATION_FAILED);
      expect((e as Error).message).toBe('Write something first.');
    }
  });

  it('does not leak internals', () => {
    try {
      validateDocument(doc({ type: 'paragraph', content: 42 }));
      expect.unreachable();
    } catch (e) {
      const m = (e as Error).message;
      expect(m).not.toMatch(/undefined|TypeError|node\[|stack/i);
    }
  });
});
