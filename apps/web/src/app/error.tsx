'use client';

import { useEffect } from 'react';
import { FailurePage, FAILURE_LINK, FAILURE_LINK_PRIMARY } from '../components/failure-page';

/**
 * When a page fails to render.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "the web app is really hanging and giving me all sorts of errors like this: {"error":{"code":
 * "INTERNAL_ERROR" ... }} ... add error pages so were not just showing raw json! this looks really
 * un professional!"
 *
 * There was no error boundary anywhere in this application. A server component that threw — because
 * the API was slow, or the database was saturated, or a query timed out — fell through to Next's
 * default screen, and a member who followed a link straight to an API route saw the raw error
 * envelope. Neither tells them the one thing they need: whether to try again.
 *
 * ★ IT SAYS "TRY AGAIN", BECAUSE USUALLY THAT WORKS ★
 *
 * The failures this catches are overwhelmingly transient — a deploy swapping containers, a slow
 * query under load, a dropped connection. `reset()` re-renders the segment without a full page
 * load, so the cheapest correct action is the most prominent one.
 *
 * ★ AND IT KEEPS THE DIGEST ★
 *
 * Next replaces a server error's message with a `digest` before it reaches the browser, on purpose:
 * the real message could name a table or a query. The digest is what ties this screen to the line
 * in the log, so it is shown as a reference to quote rather than hidden.
 */
export default function Error({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    /*
     * The browser console, not a reporting endpoint. Errors are already recorded server-side
     * against their requestId, and a client that posted its own copy would be a second, less
     * reliable record of the same event — plus a request made at exactly the moment the site is
     * struggling, which is when adding load is least welcome.
     */
    console.error(error);
  }, [error]);

  return (
    <FailurePage
      eyebrow="Something went wrong"
      title="THAT DID NOT LOAD"
      reference={error.digest ?? null}
      actions={
        <>
          <button type="button" onClick={reset} className={FAILURE_LINK_PRIMARY}>
            Try again
          </button>
          <a href="/" className={FAILURE_LINK}>
            Back to the hub
          </a>
        </>
      }
    >
      <p>
        The page could not be built just now. This is almost always temporary — the hub may be
        updating, or busy — and trying again usually works.
      </p>
      <p>
        Nothing you were doing has been lost, and nothing about your account has changed. If it
        keeps happening, tell an officer and quote the reference below.
      </p>
    </FailurePage>
  );
}
