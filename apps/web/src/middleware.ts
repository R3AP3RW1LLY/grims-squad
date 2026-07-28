import { NextResponse, type NextRequest } from 'next/server';

/**
 * Publishes the current path as a request header.
 *
 * ★ WHY THIS IS NEEDED AT ALL ★
 *
 * A server layout has no `usePathname` — that is a client hook — and Next does
 * not pass the path to layouts in any supported way. The hub sidebar needs it
 * to know which entry to mark as the current page.
 *
 * The alternatives are worse. Making the whole shell a client component would
 * ship the navigation model to the browser and lose the server-rendered first
 * paint. Threading the path down from every page would mean every new page
 * having to remember, and the one that forgets gets a sidebar with nothing
 * highlighted.
 *
 * A header set in middleware is read by the layout and by nothing else.
 */
/**
 * Where the API lives as seen from the SERVER, same as `lib/api.ts`.
 *
 * Restated rather than imported because middleware runs on the edge runtime and
 * `lib/api.ts` pulls in `next/headers`, which is not available there. The
 * default is asserted against the other two copies by a test, for the reason
 * written at length in that file: this number has already drifted once and cost
 * hours, with a symptom that pointed nowhere near the cause.
 */
const SERVER_API = process.env['API_INTERNAL_URL'] ?? 'http://localhost:5001';

/**
 * Reads a session cookie under either name.
 *
 * ★ THE PREFIX IS NOT DECIDED BY THE PROTOCOL WE CAN SEE ★
 *
 * The API applies `__Host-` when `NODE_ENV === 'production'` — not when the
 * request is https. Behind a reverse proxy those routinely disagree: the
 * browser speaks https to Caddy, Caddy speaks plain http to the app, and
 * middleware inferring the name from its own protocol would look for `gs_rt`
 * while the browser is holding `__Host-gs_rt`.
 *
 * The failure would be silent and environment-specific — working in
 * development, and signing everybody out every fifteen minutes in production,
 * which is the exact bug being fixed here. So both names are tried, and the
 * prefixed one wins because it is the stronger cookie.
 */
function sessionCookie(request: NextRequest, base: string): string | undefined {
  const prefixed = request.cookies.get(`__Host-${base}`)?.value;
  if (prefixed !== undefined && prefixed !== '') return prefixed;

  const plain = request.cookies.get(base)?.value;
  return plain === '' ? undefined : plain;
}

export async function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);

  const refreshed = await silentlyRefresh(request);

  const response = NextResponse.next({ request: { headers } });

  /*
   * The rotated cookies are copied onto the response so the BROWSER keeps them.
   * Without this the refresh would work for exactly one request and the member
   * would be signed out again on the next one.
   */
  for (const cookie of refreshed) response.headers.append('set-cookie', cookie);

  return response;
}

/**
 * Renews an expired access token from the refresh cookie, invisibly.
 *
 * ★ THE BUG THIS FIXES ★
 *
 * Sessions are fourteen days and the refresh cookie is set to match — but the
 * ACCESS cookie lives fifteen minutes, and nothing ever called `/v1/auth/refresh`.
 * The endpoint was written, tested, and had no caller.
 *
 * So a member signed in, browsed for fifteen minutes, and was bounced back
 * through Discord. The fourteen-day session existed the whole time, in a cookie
 * sitting unread in their browser. Nothing errored, because being signed out is
 * not an error — which is why this survived: every individual piece worked.
 *
 * ★ WHY MIDDLEWARE AND NOT A RETRY ON 401 ★
 *
 * A server component cannot set a cookie during render. Retrying inside the API
 * client would obtain a new token and then have nowhere to put it, so the next
 * request would start over — a refresh on every single page load. Middleware is
 * the only place in Next that can both see the request and write cookies onto
 * the response.
 *
 * Returns the `Set-Cookie` lines to forward, or an empty array when there is
 * nothing to do — which is the overwhelmingly common case.
 */
async function silentlyRefresh(request: NextRequest): Promise<string[]> {
  const hasAccess = sessionCookie(request, 'gs_at') !== undefined;
  const refresh = sessionCookie(request, 'gs_rt');

  /*
   * ONLY when the access cookie is gone and a refresh cookie remains. The
   * browser drops the access cookie by itself at the fifteen-minute mark, so
   * that combination means precisely "signed in, token aged out".
   *
   * Checked before anything else because this runs on every navigation, and the
   * normal answer must cost nothing.
   */
  if (hasAccess || refresh === undefined) return [];

  /*
   * The refresh endpoint enforces CSRF, so without the token the call is
   * rejected — and it would be rejected silently, leaving the member signed out
   * exactly as before while looking like the fix had been applied.
   */
  const csrf = sessionCookie(request, 'gs_csrf');
  if (csrf === undefined) return [];

  try {
    const res = await fetch(`${SERVER_API}/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'x-csrf-token': csrf,
        cookie: request.cookies
          .getAll()
          .map((c) => `${c.name}=${c.value}`)
          .join('; '),
      },
      cache: 'no-store',
    });

    /*
     * A refusal is a legitimate answer: the family expired, the token was
     * already used, or the member removed our app in their Discord settings.
     * All of those mean "sign in again", and the page below will say so.
     */
    if (!res.ok) return [];

    // getSetCookie() returns each header separately. Reading `get('set-cookie')`
    // would join three cookies into one string with commas, and the browser
    // would store a single malformed cookie — worse than not refreshing.
    return res.headers.getSetCookie();
  } catch {
    // The API being unreachable must not take the whole site down with it. The
    // member sees the signed-out view, which is true as far as we can tell.
    return [];
  }
}

export const config = {
  /*
   * Everything except static assets and the API proxy.
   *
   * Running on `/_next/static` would put a middleware invocation in front of
   * every stylesheet and font for a header that nothing serving them reads.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/|v1/).*)'],
};
