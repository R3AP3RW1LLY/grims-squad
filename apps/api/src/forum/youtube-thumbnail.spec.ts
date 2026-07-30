import { describe, it, expect, vi } from 'vitest';
import type { RichDocument } from '@grims/shared';
import { withYouTubeThumbnails } from './youtube-thumbnail.js';

/**
 * Fetching a video preview without telling Google who read the page.
 *
 * ★ THE TRADE THIS FILE EXISTS TO MAKE ★
 *
 * The one-line version points an `<img>` at i.ytimg.com. That reports every reader of every page
 * carrying the post to Google, on load, before anybody decides to watch — including anonymous
 * visitors on the public guides, and this squadron includes minors. It also undoes the whole point
 * of the click-to-play placeholder.
 *
 * So the server fetches it ONCE, at save time, and serves it from our own origin. One request from
 * us replaces thousands from members, and `img-src 'self'` needs no exception.
 */

const doc = (...content: RichDocument['content']): RichDocument => ({ version: 1, content });

const video = (videoId: string, thumbMediaId?: string) =>
  ({ type: 'youtube' as const, videoId, ...(thumbMediaId === undefined ? {} : { thumbMediaId }) });

/** A response big enough to pass the placeholder check. */
const realImage = (bytes = 20_000) =>
  ({ ok: true, arrayBuffer: async () => new ArrayBuffer(bytes) }) as unknown as Response;

const store = () => {
  const calls: Uint8Array[] = [];
  return {
    calls,
    store: async (_uploaderId: string, bytes: Uint8Array) => {
      calls.push(bytes);
      return `media-${calls.length}`;
    },
  };
};

describe('fetching thumbnails', () => {
  it('stores the image and puts OUR id on the node', async () => {
    const s = store();
    const fetchImpl = vi.fn(async () => realImage());

    const out = await withYouTubeThumbnails(doc(video('dQw4w9WgXcQ')), 'u1', s, fetchImpl as never);

    expect(s.calls).toHaveLength(1);
    expect(out.content[0]).toMatchObject({ type: 'youtube', thumbMediaId: 'media-1' });
  });

  it('MANDATORY: the only host it ever contacts is YouTube images', async () => {
    const fetchImpl = vi.fn(async () => realImage());
    await withYouTubeThumbnails(doc(video('dQw4w9WgXcQ')), 'u1', store(), fetchImpl as never);

    for (const call of fetchImpl.mock.calls) {
      expect(String(call[0])).toMatch(/^https:\/\/i\.ytimg\.com\//);
    }
  });

  it('MANDATORY: refuses to follow a redirect', async () => {
    /*
     * `redirect: 'error'` — otherwise a redirect from ytimg could walk this fetch onto any host,
     * and a server-side fetcher that follows arbitrary redirects is a request-forgery primitive
     * pointed at our own network.
     */
    const fetchImpl = vi.fn(async () => realImage());
    await withYouTubeThumbnails(doc(video('dQw4w9WgXcQ')), 'u1', store(), fetchImpl as never);

    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });

  it('falls back to a smaller size when the best one is missing', async () => {
    // `maxresdefault` does not exist for every video. `hqdefault` always does.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce(realImage());

    const out = await withYouTubeThumbnails(doc(video('dQw4w9WgXcQ')), 'u1', store(), fetchImpl as never);
    expect(out.content[0]).toMatchObject({ thumbMediaId: 'media-1' });
  });

  it("MANDATORY: rejects YouTube's grey placeholder, which arrives as a 200", async () => {
    /*
     * A size a video does not have can come back 200 with a tiny grey image rather than a 404.
     * Storing that gives every such post a blank grey preview that looks like OUR bug.
     */
    const s = store();
    const fetchImpl = vi.fn(async () => realImage(500));

    const out = await withYouTubeThumbnails(doc(video('dQw4w9WgXcQ')), 'u1', s, fetchImpl as never);

    expect(s.calls).toHaveLength(0);
    expect(out.content[0]).not.toHaveProperty('thumbMediaId');
  });
});

describe('what it does not do', () => {
  it('MANDATORY: a failure never loses the post', async () => {
    // Losing a preview is not a reason to refuse somebody's writing.
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    const input = doc(video('dQw4w9WgXcQ'));
    const out = await withYouTubeThumbnails(input, 'u1', store(), fetchImpl as never);

    expect(out.content[0]).toMatchObject({ type: 'youtube', videoId: 'dQw4w9WgXcQ' });
    expect(out.content[0]).not.toHaveProperty('thumbMediaId');
  });

  it('does not re-fetch a video that already has one', async () => {
    // Otherwise every edit of a post re-downloads and re-stores every video in it.
    const s = store();
    const fetchImpl = vi.fn(async () => realImage());

    await withYouTubeThumbnails(doc(video('dQw4w9WgXcQ', 'already-there')), 'u1', s, fetchImpl as never);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(s.calls).toHaveLength(0);
  });

  it('fetches the same video once even when embedded twice', async () => {
    const s = store();
    const fetchImpl = vi.fn(async () => realImage());

    const out = await withYouTubeThumbnails(
      doc(video('dQw4w9WgXcQ'), video('dQw4w9WgXcQ')),
      'u1',
      s,
      fetchImpl as never,
    );

    expect(s.calls).toHaveLength(1);
    // Both nodes get the id — the second reuses the first rather than uploading a duplicate.
    expect(out.content[0]).toMatchObject({ thumbMediaId: 'media-1' });
    expect(out.content[1]).toMatchObject({ thumbMediaId: 'media-1' });
  });

  it('does nothing at all for a document with no video', async () => {
    const fetchImpl = vi.fn();
    const input = doc({ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] });

    const out = await withYouTubeThumbnails(input, 'u1', store(), fetchImpl as never);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out).toBe(input);
  });
});
