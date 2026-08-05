import type { RichDocument } from '@grims/shared';

/**
 * Fetching a YouTube thumbnail once, on OUR server, so readers never touch Google.
 *
 * ★ THE PROBLEM WITH THE OBVIOUS VERSION ★
 *
 * Squadron owner, 2026-07-30: "there is no thumbnail or preview, we need this please. preferably
 * from youtube link."
 *
 * The one-line version points an `<img>` at `i.ytimg.com`. That reports every reader of every page
 * carrying that post to Google — on page load, before anybody decides to watch anything, including
 * anonymous visitors reading the public guides. It is also the exact thing the click-to-play
 * placeholder was built to avoid, so adding it would quietly undo that work. `img-src 'self'` would
 * block it anyway, which is the CSP doing its job rather than an obstacle to route around.
 *
 * ★ SO THE SERVER FETCHES IT, ONCE ★
 *
 * At save time, once per video, through the ordinary media pipeline — so the image is hardened,
 * re-encoded, EXIF-stripped and served from our own origin like every other picture on the site.
 * One request from us at post time replaces thousands from members at read time, and the CSP needs
 * no exception.
 *
 * ★ FAILURE IS NOT AN ERROR ★
 *
 * If YouTube is unreachable or the video has no thumbnail, the post saves anyway with the CSS
 * placeholder it has always had. Losing a preview is not a reason to refuse somebody's writing.
 */

/** Where YouTube serves thumbnails. The only third-party host this file ever contacts. */
const THUMBNAIL_HOST = 'https://i.ytimg.com';

/**
 * Candidate sizes, best first.
 *
 * `maxresdefault` does not exist for every video and returns a 404 — or worse, a 120×90 grey
 * placeholder with a 200 — so `hqdefault` is the reliable fallback and is always present.
 */
const SIZES = ['maxresdefault.jpg', 'hqdefault.jpg'] as const;

/** A thumbnail smaller than this is YouTube's grey "no image" placeholder, not a real frame. */
const MIN_PLAUSIBLE_BYTES = 3_000;

export interface ThumbnailStore {
  /** Stores bytes through the normal upload pipeline and returns the media id. */
  store(uploaderId: string, bytes: Uint8Array): Promise<string>;
}

/**
 * Fills in `thumbMediaId` for every YouTube node that lacks one.
 *
 * Returns a NEW document; the input is not mutated. Nodes that already have a thumbnail are left
 * alone, so editing a post does not re-fetch every video in it.
 */
export async function withYouTubeThumbnails(
  doc: RichDocument,
  uploaderId: string,
  store: ThumbnailStore,
  fetchImpl: typeof fetch = fetch,
): Promise<RichDocument> {
  const videos = doc.content.filter(
    (b): b is Extract<typeof b, { type: 'youtube' }> =>
      b.type === 'youtube' && b.thumbMediaId === undefined,
  );
  if (videos.length === 0) return doc;

  /*
   * Deduplicated. The same video embedded twice in one post is one fetch and one stored image —
   * and the map means the second node gets the first node's id rather than a duplicate upload.
   */
  const ids = [...new Set(videos.map((v) => v.videoId))];
  const fetched = new Map<string, string>();

  await Promise.all(
    ids.map(async (videoId) => {
      const mediaId = await fetchOne(videoId, uploaderId, store, fetchImpl);
      if (mediaId !== null) fetched.set(videoId, mediaId);
    }),
  );

  return {
    ...doc,
    content: doc.content.map((b) => {
      if (b.type !== 'youtube' || b.thumbMediaId !== undefined) return b;
      const mediaId = fetched.get(b.videoId);
      return mediaId === undefined ? b : { ...b, thumbMediaId: mediaId };
    }),
  };
}

async function fetchOne(
  videoId: string,
  uploaderId: string,
  store: ThumbnailStore,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  for (const size of SIZES) {
    try {
      /*
       * The id was validated against `YOUTUBE_ID` — exactly eleven characters of the URL-safe
       * alphabet, anchored — before it could reach a stored document. So it cannot contain a slash
       * or a dot and cannot escape this path. Encoded anyway, because a guarantee that rests on a
       * regex somewhere else is worth one line here.
       */
      const res = await fetchImpl(
        `${THUMBNAIL_HOST}/vi/${encodeURIComponent(videoId)}/${size}`,
        { redirect: 'error' },
      );
      if (!res.ok) continue;

      const bytes = new Uint8Array(await res.arrayBuffer());
      // YouTube answers 200 with a tiny grey placeholder for sizes a video does not have.
      if (bytes.byteLength < MIN_PLAUSIBLE_BYTES) continue;

      return await store.store(uploaderId, bytes);
    } catch {
      /*
       * Network failure, a refused redirect, or the hardener rejecting the image. Try the next
       * size, and if none work the caller gets null and the post keeps its CSS placeholder.
       */
      continue;
    }
  }
  return null;
}
