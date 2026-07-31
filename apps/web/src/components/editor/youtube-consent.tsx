'use client';

import { useEffect } from 'react';

/**
 * Turns a stored video placeholder into a player, but only when a reader asks.
 *
 * ★ WHY THE IFRAME IS CREATED HERE AND NOT STORED ★
 *
 * The stored HTML for a video contains no iframe and no reference to any Google domain — not even
 * a thumbnail from `img.youtube.com`. That is deliberate on two counts:
 *
 *   Privacy. An embedded player, or even its thumbnail, reports every reader of the page to
 *   Google whether they watch or not. This squadron includes minors (D15), and the protective
 *   defaults that decision produced are the reason this is not merely a preference.
 *
 *   CSP. `frame-src 'none'` stays in force for anybody who does not click. The allowance for
 *   youtube.com is narrow and only matters once a reader has asked for it.
 *
 * ★ WHY A DELEGATED LISTENER RATHER THAN A COMPONENT PER VIDEO ★
 *
 * The post body arrives as server-rendered HTML through `dangerouslySetInnerHTML`, so there are no
 * React components inside it to attach handlers to. One listener on the document handles every
 * video on the page, including ones added by a later render — which a per-node effect would miss.
 */
export function YouTubeConsent() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('[data-youtube-play]');
      if (button === null || button === undefined) return;

      const videoId = button.getAttribute('data-youtube-play');
      /*
       * Re-validated HERE, even though the server already validated it before storage.
       *
       * The attribute is read out of the DOM, and the DOM is not a trust boundary — a browser
       * extension, a devtools edit, or a future bug that renders an unvalidated document would all
       * put an arbitrary string in front of this line. It is the last thing between a value and a
       * URL, so it checks rather than assumes.
       */
      if (videoId === null || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;

      const container = button.closest('[data-youtube]');
      if (container === null) return;

      const frame = document.createElement('iframe');
      /*
       * `youtube-nocookie.com`, not `youtube.com`. It is the same player without the tracking
       * cookies on first load — a smaller disclosure for a reader who has decided to watch.
       *
       * The URL is built from a validated 11-character id and nothing else, so there is no part of
       * it a document could influence.
       */
      frame.src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&autoplay=1`;
      frame.title = 'YouTube video';
      frame.loading = 'lazy';
      frame.allow = 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen';
      /*
       * ★ allow-same-origin IS REQUIRED, AND LEAVING IT OUT BROKE PLAYBACK ★
       *
       * Squadron owner, 2026-07-31: "when i click a video to play, it just shows a stale black
       * screen it does not actually play the video".
       *
       * That was this line. Without `allow-same-origin` the browser gives the frame an OPAQUE
       * origin, so the player cannot reach its own storage or its own origin's resources — it
       * fails during start-up and renders a black rectangle. Nothing errors on our side, because
       * nothing on our side went wrong.
       *
       * ★ THE ORIGINAL COMMENT HERE WAS WRONG, SO IT IS WORTH CORRECTING PROPERLY ★
       *
       * It claimed omitting the flag stopped the frame "reaching our origin". It does not do that
       * and never did. `allow-same-origin` means the framed document keeps ITS OWN origin —
       * youtube-nocookie.com — and the same-origin policy still stands between that and us. A
       * cross-origin frame cannot touch our DOM either way.
       *
       * The real hazard with `allow-scripts allow-same-origin` is a SAME-ORIGIN frame, which could
       * then reach into its own sandbox attribute and remove it. This frame is cross-origin by
       * construction: the URL is built from a validated 11-character id and a fixed host, so there
       * is no input that could make it point at us.
       *
       * `allow-top-navigation` remains absent, which is the flag that actually matters here — it is
       * what stops an embed navigating the page out from under a reader.
       */
      frame.setAttribute(
        'sandbox',
        'allow-scripts allow-same-origin allow-presentation allow-popups',
      );
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      frame.className = 'doc-embed-frame';

      container.replaceChildren(frame);
    }

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return null;
}
