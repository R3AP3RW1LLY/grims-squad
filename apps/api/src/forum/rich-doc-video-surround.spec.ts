import { describe, it, expect } from 'vitest';
import { validateDocument, renderDocument, documentToText } from './rich-doc.js';

/**
 * A video surrounded by writing.
 *
 * ★ SQUADRON OWNER, 2026-07-31 ★
 *
 * "a video can not break, its a blog so there will be text that pre and proceeds it this is
 * non-negotiable!"
 *
 * ★ WHY THIS FILE EXISTS EVEN THOUGH NOTHING WAS BROKEN ★
 *
 * While diagnosing the paste bug I reported, then withdrew, a claim that a video disappeared from
 * the rendered HTML when a paragraph came before it. It never did — my probe printed the document
 * with a `grep` that kept only the first line of a newline-joined string, so the second block was
 * filtered out of my own output rather than out of the page.
 *
 * That was a bad five minutes of reading, and it is exactly the sort of thing that should leave a
 * test behind rather than an apology. The behaviour the owner depends on is now pinned: a video
 * survives with content before it, after it, on both sides, and among every other block type.
 *
 * If any of this ever DOES break, this file fails loudly instead of somebody discovering it in a
 * published post.
 */

const VIDEO = 'dQw4w9WgXcQ';
/** A real uuid. `thumbMediaId` is validated as one — see the note in the thumbnail test below. */
const THUMB = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const video = (extra: Record<string, unknown> = {}) => ({ type: 'youtube', videoId: VIDEO, ...extra });

describe('MANDATORY: a video never disappears because of what surrounds it', () => {
  it('text before it', () => {
    const html = renderDocument(validateDocument({ version: 1, content: [para('before'), video()] }));
    expect(html).toContain('before');
    expect(html).toContain(`data-youtube="${VIDEO}"`);
  });

  it('text after it', () => {
    const html = renderDocument(validateDocument({ version: 1, content: [video(), para('after')] }));
    expect(html).toContain(`data-youtube="${VIDEO}"`);
    expect(html).toContain('after');
  });

  it('MANDATORY: text on BOTH sides — the blog case', () => {
    const doc = validateDocument({
      version: 1,
      content: [para('intro'), video(), para('outro')],
    });
    const html = renderDocument(doc);

    // All three survive, and in the order they were written.
    expect(doc.content).toHaveLength(3);
    expect(html.indexOf('intro')).toBeLessThan(html.indexOf('data-youtube'));
    expect(html.indexOf('data-youtube')).toBeLessThan(html.indexOf('outro'));
  });

  it('several videos interleaved with paragraphs', () => {
    // A build log or a guide with a clip per step. Each embed must appear once, in place.
    const doc = validateDocument({
      version: 1,
      content: [para('one'), video(), para('two'), video(), para('three')],
    });
    const html = renderDocument(doc);

    expect(doc.content).toHaveLength(5);
    expect(html.match(/data-youtube="/g)).toHaveLength(2);
    for (const word of ['one', 'two', 'three']) expect(html).toContain(word);
  });

  it('among every other block type', () => {
    /*
     * The renderer walks blocks independently, so a neighbour cannot swallow one. Asserted rather
     * than assumed, because "it works next to a paragraph" is a much weaker claim than the owner
     * is relying on.
     */
    const doc = validateDocument({
      version: 1,
      content: [
        { type: 'heading', level: 2, content: [{ type: 'text', text: 'Heading' }] },
        para('lead in'),
        { type: 'bulletList', content: [{ type: 'listItem', content: [para('a point')] }] },
        video(),
        { type: 'blockquote', content: [para('quoted')] },
        { type: 'codeBlock', text: 'const x = 1;' },
        { type: 'divider' },
        para('closing'),
      ],
    });
    const html = renderDocument(doc);

    expect(html).toContain(`data-youtube="${VIDEO}"`);
    for (const word of ['Heading', 'lead in', 'a point', 'quoted', 'const x = 1;', 'closing']) {
      expect(html).toContain(word);
    }
  });

  it('MANDATORY: renderDocument joins blocks with a newline — the thing that misled me', () => {
    /*
     * The literal cause of the false alarm. The output is multi-line, so anything reading it a line
     * at a time sees only the first block. Pinned so the shape of the output is a documented fact
     * rather than a surprise to the next person debugging it.
     */
    const html = renderDocument(validateDocument({ version: 1, content: [para('before'), video()] }));
    const lines = html.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toBe('<p>before</p>');
    expect(lines[1]).toContain('data-youtube');
  });

  it('the plain-text form keeps the surrounding writing', () => {
    // Used for search indexing and notification previews. A video contributes its title, if any.
    const text = documentToText(
      validateDocument({ version: 1, content: [para('intro'), video({ title: 'Clip' }), para('outro')] }),
    );
    expect(text).toContain('intro');
    expect(text).toContain('Clip');
    expect(text).toContain('outro');
  });
});

describe('MANDATORY: the thumbnail id survives, when it is a real one', () => {
  it('a uuid is kept and reaches the HTML', () => {
    /*
     * The second claim I withdrew. `thumbMediaId` is only accepted as a uuid, because it names an
     * object WE minted — and my probe had passed the string `media-1`, so it was correctly refused.
     * With a real id it survives validation and renders as the preview image.
     */
    const doc = validateDocument({ version: 1, content: [para('before'), video({ thumbMediaId: THUMB })] });
    const block = doc.content[1] as { thumbMediaId?: string };

    expect(block.thumbMediaId).toBe(THUMB);
    expect(renderDocument(doc)).toContain(THUMB);
  });

  it('a non-uuid is dropped rather than trusted', () => {
    /*
     * Deliberate, and worth keeping. An edit round-trips the whole document through the browser, so
     * on a second save this field arrives from a client — and a client-supplied media id would let
     * somebody point a post's preview at any object in the bucket.
     */
    const doc = validateDocument({ version: 1, content: [video({ thumbMediaId: 'media-1' })] });
    expect((doc.content[0] as { thumbMediaId?: string }).thumbMediaId).toBeUndefined();
  });

  it('no thumbnail still renders a working embed', () => {
    // The CSS placeholder. This is what a post looks like when YouTube was unreachable at save time.
    const html = renderDocument(validateDocument({ version: 1, content: [video()] }));
    expect(html).toContain('doc-embed-play');
    expect(html).toContain(`data-youtube-play="${VIDEO}"`);
  });
});
