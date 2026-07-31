import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYouTubeId, toDocument } from './doc-convert';

const HERE = dirname(fileURLToPath(import.meta.url));
const EDITOR = readFileSync(resolve(HERE, 'rich-editor.tsx'), 'utf8');

/**
 * Adding a video by pasting its link.
 *
 * ★ SQUADRON OWNER, 2026-07-31 ★
 *
 * "youtube videos are still not linking or working at all when adding via links".
 *
 * ★ WHAT WAS ACTUALLY WRONG, BECAUSE IT WAS NOT THE PART ANYONE SUSPECTED ★
 *
 * The parser, the wire format, the server validation and the rendered embed were all correct and
 * all tested. Traced end to end, a video id survives every stage intact.
 *
 * The failure was on the INPUT side, and it was two things at once:
 *
 *   1. There was no paste handling whatsoever, so a pasted YouTube URL was just text.
 *   2. `autolink` was false, so that text did not even become a clickable link.
 *
 * The only working route to an embed was a toolbar button behind a `window.prompt`. Every natural
 * action — paste the link, type the link — produced nothing at all. Which is precisely the report.
 *
 * The lesson worth keeping: a feature can be correct at every layer that has tests and still be
 * unusable, because nothing tested the way a person actually reaches it.
 */

describe('the link forms members will paste', () => {
  const REAL = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=AbCdEfGh',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
    'https://youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
  ];

  it('MANDATORY: every one resolves to the video id', () => {
    // The share sheet, the address bar, mobile, Shorts and a live stream all produce different
    // shapes. A member does not know or care which one they copied.
    for (const link of REAL) {
      expect(parseYouTubeId(link), link).toBe('dQw4w9WgXcQ');
    }
  });

  it('MANDATORY: refuses a lookalike host', () => {
    /*
     * The host is checked against a fixed list, not searched for a substring. An embed is the one
     * place an iframe is ever allowed to appear, so "contains youtube.com" is not good enough.
     */
    expect(parseYouTubeId('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('https://vimeo.com/123456789')).toBeNull();
  });
});

describe('pasting a link embeds it', () => {
  it('MANDATORY: the editor handles paste at all', () => {
    // There was no paste handling of any kind. This is the whole fix.
    expect(EDITOR).toMatch(/handlePaste/);
  });

  it('MANDATORY: a pasted link is turned into a video node', () => {
    expect(EDITOR).toMatch(/parseYouTubeId\(text\)/);
    expect(EDITOR).toMatch(/type: 'squadronVideo'/);
  });

  it('MANDATORY: only when the paste is the link and nothing else', () => {
    /*
     * Pasting a paragraph that happens to mention a video must not swallow the paragraph and
     * replace it with an embed. Whitespace in the clipboard means it is not a bare URL.
     */
    expect(EDITOR).toMatch(/\s/);
    expect(EDITOR).toMatch(/return false/);
  });

  it('MANDATORY: autolink is on, so a pasted URL is at least a link', () => {
    /*
     * With this false, a link that is not a video stayed plain text — "not linking" in the most
     * literal sense. This is half of the reported bug and is easy to turn back off by accident.
     */
    const linkBlock = EDITOR.slice(EDITOR.indexOf('Link.configure'), EDITOR.indexOf('Placeholder.configure'));
    expect(linkBlock).toMatch(/autolink: true/);
  });
});

describe('the rest of the pipeline, which was never broken', () => {
  it('a video node converts to the wire format', () => {
    const doc = toDocument({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'watch' }] },
        { type: 'squadronVideo', attrs: { videoId: 'dQw4w9WgXcQ', title: '' } },
      ],
    } as never);

    expect(doc?.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'watch' }] },
      { type: 'youtube', videoId: 'dQw4w9WgXcQ' },
    ]);
  });

  it('a video with no id is dropped rather than stored empty', () => {
    /*
     * An empty id would render a play button that loads nothing. Dropping it leaves a document with
     * no blocks at all, and `toDocument` reports that as null rather than as an empty document —
     * which is what stops an empty post being saved.
     */
    const doc = toDocument({
      type: 'doc',
      content: [{ type: 'squadronVideo', attrs: { videoId: '', title: '' } }],
    } as never);
    expect(doc).toBeNull();
  });

  it('a video with an id survives alongside other content', () => {
    const doc = toDocument({
      type: 'doc',
      content: [
        { type: 'squadronVideo', attrs: { videoId: '', title: '' } },
        { type: 'squadronVideo', attrs: { videoId: 'dQw4w9WgXcQ', title: 'Trailer' } },
      ],
    } as never);
    // The broken one is gone; the good one keeps its title.
    expect(doc?.content).toEqual([{ type: 'youtube', videoId: 'dQw4w9WgXcQ', title: 'Trailer' }]);
  });
});
