/**
 * Signing in from the app.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "COMPANION Discord login; remove key generator"
 *
 * ★ THE APP NEVER TOUCHES THE SIGN-IN ★
 *
 * The tempting build is a Discord OAuth window inside Electron. It is also the wrong one: a
 * desktop app has nowhere to keep a client secret, and a member typing their Discord password into
 * a window an application controls is exactly the habit phishing depends on. A loopback redirect is
 * no better — anything else running on the machine can race the listener.
 *
 * So the app asks the server for a link, opens the member's REAL browser at a page on our site, and
 * waits. They sign in with Discord there, in a window with an address bar, in the session they
 * already have. The app then collects a device token over a channel authenticated by a secret it
 * generated and never displayed.
 *
 * What the member does: press a button, click approve. No code to copy, nothing to keep safe.
 */

export interface LinkStarted {
  readonly code: string;
  readonly pollSecret: string;
  readonly verifyUrl: string;
  readonly expiresAt: number;
}

export type LinkOutcome =
  | { readonly status: 'approved'; readonly token: string }
  | { readonly status: 'expired' }
  | { readonly status: 'gone' }
  | { readonly status: 'cancelled' };

/** How often to ask whether the member has approved yet. */
export const POLL_EVERY_MS = 2_000;

/**
 * Starts a link.
 *
 * Throws on a network failure rather than returning a state, because "could not reach the server"
 * is a different conversation from "not approved yet" and collapsing them would have the app sit
 * there waiting for an approval that can never arrive.
 */
export async function startLink(
  apiBaseUrl: string,
  label: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LinkStarted> {
  const res = await fetchImpl(`${apiBaseUrl.replace(/\/+$/, '')}/v1/telemetry/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error(`The squadron site answered ${res.status}.`);

  const body = (await res.json()) as Partial<Record<string, unknown>>;
  const code = typeof body['code'] === 'string' ? body['code'] : '';
  const pollSecret = typeof body['pollSecret'] === 'string' ? body['pollSecret'] : '';
  const verifyUrl = typeof body['verifyUrl'] === 'string' ? body['verifyUrl'] : '';
  const expiresAt = Date.parse(String(body['expiresAt'] ?? ''));

  if (code === '' || pollSecret === '' || verifyUrl === '') {
    throw new Error('The squadron site sent an answer this version does not understand.');
  }

  return { code, pollSecret, verifyUrl, expiresAt: Number.isNaN(expiresAt) ? 0 : expiresAt };
}

/**
 * Waits for the member to approve, then collects the token.
 *
 * ★ IT STOPS. ALWAYS. ★
 *
 * A poll loop with no exit is how an app ends up hammering an endpoint forever because somebody
 * closed the browser tab. Three separate things end it: the server saying expired or gone, the
 * link's own deadline passing, and the caller cancelling. A transient network error does NOT end
 * it — the member is mid-approval and a dropped packet must not lose their work.
 */
export async function awaitApproval(
  apiBaseUrl: string,
  started: LinkStarted,
  opts: {
    readonly fetchImpl?: typeof fetch;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
    readonly cancelled?: () => boolean;
  } = {},
): Promise<LinkOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const cancelled = opts.cancelled ?? ((): boolean => false);
  const base = apiBaseUrl.replace(/\/+$/, '');

  for (;;) {
    if (cancelled()) return { status: 'cancelled' };

    /*
     * The link's own deadline, checked here as well as on the server. Without it a server that
     * became unreachable the moment the member pressed the button would leave this loop retrying
     * until the app is closed.
     */
    if (started.expiresAt > 0 && now() > started.expiresAt + POLL_EVERY_MS * 2) {
      return { status: 'expired' };
    }

    try {
      const res = await fetchImpl(
        `${base}/v1/telemetry/links/${encodeURIComponent(started.code)}/poll`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pollSecret: started.pollSecret }),
        },
      );

      if (res.ok) {
        const body = (await res.json()) as { status?: unknown; token?: unknown };
        if (body.status === 'approved' && typeof body.token === 'string') {
          return { status: 'approved', token: body.token };
        }
        if (body.status === 'expired') return { status: 'expired' };
        if (body.status === 'gone') return { status: 'gone' };
      }
    } catch {
      /*
       * Swallowed on purpose. The member is in the middle of approving in another window, and
       * giving up on one dropped request would throw that away — they would press approve, see it
       * succeed on the website, and find the app still asking them to sign in.
       */
    }

    await sleep(POLL_EVERY_MS);
  }
}
