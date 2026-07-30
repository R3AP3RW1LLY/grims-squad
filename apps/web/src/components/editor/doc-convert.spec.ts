import { describe, it, expect } from 'vitest';
import type { RichDocument } from '@grims/shared';
import { toDocument, fromDocument, parseYouTubeId } from './doc-convert';

/**
 * The conversion between our document format and the editor's.
 *
 * ★ THE ROUND TRIP IS THE THING WORTH TESTING ★
 *
 * A round trip that quietly alters somebody's layout means opening a post and saving it again
 * degrades it — the kind of bug that destroys trust in an editor and is almost never noticed until
 * a guide looks wrong weeks later.
 */

const pm = (...content: unknown[]) => ({ type: 'doc', content: content as never[] });

describe('parseYouTubeId', () => {
  it('accepts every form a member might paste', () => {
    for (const input of [
      'dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      '  https://youtu.be/dQw4w9WgXcQ  ',
    ]) {
      expect(parseYouTubeId(input), input).toBe('dQw4w9WgXcQ');
    }
  });

  it('MANDATORY: refuses a non-YouTube host with a plausible path', () => {
    /*
     * ★ THE BYPASS THIS EXISTS FOR ★
     *
     * An embed is the ONE place an iframe is permitted to appear. A parser that accepted any URL
     * with an 11-character segment would let `https://evil.test/aaaaaaaaaaa` become one — so the
     * host is checked against a fixed list BEFORE any id is extracted.
     */
    for (const input of [
      'https://evil.test/dQw4w9WgXcQ',
      // Suffix that merely begins with the real host.
      'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
      'https://youtu.be.evil.test/dQw4w9WgXcQ',
      'https://evil.test/watch?v=dQw4w9WgXcQ',
      /*
       * ★ USERINFO, IN THE DANGEROUS DIRECTION ★
       *
       * The real host is what follows the `@`, so here it is `evil.test` and this must be
       * refused. This is the form that defeats a naive "does the URL contain youtube.com"
       * check — which would see the substring and say yes.
       */
      'https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ',
      'https://youtu.be@evil.test/dQw4w9WgXcQ',
    ]) {
      expect(parseYouTubeId(input), input).toBeNull();
    }
  });

  it('ACCEPTS userinfo in the harmless direction, because the host is genuinely YouTube', () => {
    /*
     * ★ A TEST OF MINE WAS WRONG HERE, AND THE PARSER WAS RIGHT ★
     *
     * I first asserted that `https://evil.test@youtube.com/watch?v=...` must be refused, on the
     * assumption that any userinfo is an attack. It is not: in that URL `evil.test` is the
     * userinfo and the actual host IS `youtube.com`, so the video really does come from YouTube.
     *
     * The parser uses `URL().hostname`, which is authoritative — that is precisely why it is not
     * fooled the way substring matching is. And nothing but the 11-character id is ever kept, so
     * the rest of the URL cannot survive to matter.
     *
     * Worth keeping as a test because the next person to read the refusal list above will wonder
     * why one userinfo case is refused and this one is not.
     */
    expect(parseYouTubeId('https://evil.test@youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('refuses malformed input and wrong-length ids', () => {
    for (const input of ['', 'not a url', 'https://youtu.be/short', 'https://youtu.be/waytoolongforanid', 'javascript:alert(1)']) {
      expect(parseYouTubeId(input), input).toBeNull();
    }
  });
});

describe('editor state -> document', () => {
  it('converts the ordinary blocks', () => {
    const doc = toDocument(
      pm(
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Step 1' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Do the thing' }] },
        { type: 'horizontalRule' },
      ),
    );

    expect(doc?.content).toEqual([
      { type: 'heading', level: 2, content: [{ type: 'text', text: 'Step 1' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Do the thing' }] },
      { type: 'divider' },
    ]);
  });

  it('MANDATORY: drops a node type our format does not model', () => {
    /*
     * Deliberate, and matched to the server, which REFUSES unknown nodes. If the editor were ever
     * configured with an extension we do not support, letting it through would produce a save that
     * fails with "unsupported content" and no clue which part. Dropping it means the author sees it
     * vanish while editing, which is a much better signal.
     */
    const doc = toDocument(
      pm(
        { type: 'paragraph', content: [{ type: 'text', text: 'keep' }] },
        { type: 'table', content: [] },
        { type: 'iframe', attrs: { src: 'https://evil.test' } },
      ),
    );

    expect(doc?.content).toHaveLength(1);
    expect(JSON.stringify(doc)).not.toContain('evil.test');
  });

  it('MANDATORY: drops an unmodelled MARK but keeps the text', () => {
    // Losing the styling is acceptable; losing the words is not.
    const doc = toDocument(
      pm({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'hello',
            marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: 'red' } }],
          },
        ],
      }),
    );

    expect(doc?.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'hello', marks: [{ type: 'bold' }] }],
    });
  });

  it('MANDATORY: an image with no mediaId is dropped rather than saved broken', () => {
    // An image node still uploading has no id yet. Saving it would store a reference to nothing.
    const doc = toDocument(
      pm(
        { type: 'squadronImage', attrs: { mediaId: '', alt: 'pending' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'text' }] },
      ),
    );

    expect(doc?.content).toHaveLength(1);
    expect(doc?.content[0]?.type).toBe('paragraph');
  });

  it('clamps a heading deeper than we model', () => {
    // An h4 is clearly still meant to be a heading, so it becomes h3 rather than vanishing.
    const doc = toDocument(pm({ type: 'heading', attrs: { level: 5 }, content: [{ type: 'text', text: 'x' }] }));
    expect(doc?.content[0]).toMatchObject({ type: 'heading', level: 3 });
  });

  it('MANDATORY: returns null for an empty document', () => {
    expect(toDocument(pm())).toBeNull();
    expect(toDocument(pm({ type: 'paragraph' }))).toBeNull();
    expect(toDocument(pm({ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }))).toBeNull();
  });

  it('an image ALONE is not empty', () => {
    const doc = toDocument(
      pm({ type: 'squadronImage', attrs: { mediaId: 'abc', alt: 'the error', align: 'center', widthPercent: 80 } }),
    );
    expect(doc).not.toBeNull();
    expect(doc?.content[0]).toMatchObject({ type: 'image', widthPercent: 80 });
  });

  it('drops empty text runs, which a paste can produce', () => {
    /*
     * An empty run carrying marks renders as `<strong></strong>` — invisible, and enough to make a
     * document look non-empty to the server's substance check.
     */
    const doc = toDocument(
      pm({
        type: 'paragraph',
        content: [
          { type: 'text', text: '', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'real' },
        ],
      }),
    );
    expect(doc?.content[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'real' }] });
  });
});

describe('the round trip is faithful', () => {
  const original: RichDocument = {
    version: 1,
    content: [
      { type: 'heading', level: 2, content: [{ type: 'text', text: 'Joining' }] },
      {
        type: 'paragraph',
        align: 'center',
        content: [
          { type: 'text', text: 'See ' },
          { type: 'text', text: 'Inara', marks: [{ type: 'link', href: 'https://inara.cz' }, { type: 'bold' }] },
        ],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] },
      { type: 'codeBlock', text: 'pnpm dev' },
      { type: 'divider' },
      { type: 'image', mediaId: 'aaaa', alt: 'shot', align: 'right', widthPercent: 50, caption: 'cap' },
      { type: 'youtube', videoId: 'dQw4w9WgXcQ', title: 'A video' },
    ],
  };

  it('MANDATORY: document -> editor -> document is identical', () => {
    /*
     * The property that matters. If this drifts, opening a post and saving it again silently
     * changes it — layout lost, alignment reset, captions dropped — and nobody notices until a
     * guide looks wrong.
     */
    const back = toDocument(fromDocument(original) as never);
    expect(back).toEqual(original);
  });

  it('survives two round trips, so drift cannot accumulate', () => {
    const once = toDocument(fromDocument(original) as never);
    const twice = toDocument(fromDocument(once as RichDocument) as never);
    expect(twice).toEqual(original);
  });

  it('handles an empty code block, which ProseMirror is fussy about', () => {
    /*
     * A text node with an empty string is rejected by ProseMirror, and an empty content array is
     * not the same as an absent one — so this case has its own branch, and its own test.
     */
    const doc: RichDocument = { version: 1, content: [{ type: 'codeBlock', text: '' }] };
    const pmDoc = fromDocument(doc) as { content?: Array<{ content?: unknown }> };

    expect(pmDoc.content?.[0]).toEqual({ type: 'codeBlock' });
    expect(pmDoc.content?.[0]).not.toHaveProperty('content');
  });

  it('does not invent alignment where there was none', () => {
    // `left` is the default and is omitted from the document, so a plain paragraph must not come
    // back carrying an explicit alignment.
    const doc: RichDocument = {
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }],
    };
    const back = toDocument(fromDocument(doc) as never);
    expect(back?.content[0]).not.toHaveProperty('align');
  });
});
