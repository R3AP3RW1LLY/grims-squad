'use client';

import { useEffect, useState } from 'react';
import { apiPost } from '../../../../lib/api-client';

/**
 * Starts the Frontier handshake and leaves.
 *
 * ★ IT REDIRECTS RATHER THAN OFFERING A BUTTON ★
 *
 * The member has already pressed a button — in the app, which is what sent them here. A second one
 * asking them to confirm the thing they just asked for is a step that exists only because of how
 * this is plumbed, and they would rightly read it as the app not having worked.
 *
 * ★ AND IT SAYS SO WHEN IT FAILS ★
 *
 * The failure that matters is a member who is not signed in on this browser: the app is paired, the
 * website is not, and `capiStart` answers 401. Silently doing nothing there is exactly the dead end
 * being fixed — so the hub's own sentence is shown, with the one thing they can do about it.
 */
export function StartFrontier() {
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { url } = await apiPost<{ url: string }>('/v1/me/capi/start');
        if (cancelled) return;
        /*
         * `replace`, not `assign`: pressing Back from Frontier must not land on this page and start
         * a second handshake, which would strand the first one's PKCE state and look like a loop.
         */
        window.location.replace(url);
      } catch (e) {
        if (!cancelled) {
          setProblem(
            e instanceof Error && e.message !== ''
              ? e.message
              : 'We could not start the Frontier sign-in. Sign in to the website and try again.',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="m-0 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
        {problem === null ? 'Taking you to Frontier' : 'Frontier sign-in'}
      </p>

      {problem === null ? (
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          Your browser is being handed to Frontier to sign in. Nothing about that sign-in is stored
          on your machine.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-[var(--color-semantic-hostile-bright)]">{problem}</p>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            Sign in to the website in this browser, then press Connect with Frontier in the app
            again.
          </p>
        </>
      )}
    </div>
  );
}
