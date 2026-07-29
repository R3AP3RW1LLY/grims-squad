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

/**
 * May this request for a brand asset be served?
 *
 * ★ EXTRACTED SO IT CAN BE TESTED ★
 *
 * The first version of this rule also refused requests carrying NO fetch
 * metadata, which broke every logo on the site: `_next/image` fetches the
 * source file over HTTP from the server to itself and sends no browser
 * metadata, so the optimiser was handed a 404 and answered "The requested
 * resource isn't a valid image".
 *
 * Nothing caught it. The page still contained the right URL, so a check that
 * looked at the markup passed while every image was blank. A rule with a
 * failure mode that invisible belongs in a function with tests around it.
 */
export function brandAssetAllowed(
  dest: string | null,
  site: string | null,
): boolean {
  // Opening the file itself: the address bar, or "open image in new tab".
  if (dest === 'document') return false;
  // Another site embedding our artwork.
  if (site === 'cross-site') return false;
  /*
   * Everything else is allowed, deliberately — our own pages, the manifest
   * fetching its icons, and the image optimiser. See the note at the call site
   * for why refusing bare requests is not worth what it costs.
   */
  return true;
}

export async function middleware(request: NextRequest) {
  /*
   * ★ BRAND ASSETS CANNOT BE OPENED OR HOTLINKED ★
   *
   * Squadron owner, 2026-07-29: the logo assets must not be downloadable from
   * the website. This is the only part a server can enforce, and it is worth
   * being exact about what it does and does not cover.
   *
   * REFUSED:
   *   Sec-Fetch-Dest: document     pasting the URL in the address bar, and
   *                                right-click -> "open image in new tab"
   *   Sec-Fetch-Site: cross-site   another site hotlinking our artwork
   *
   * ALLOWED: everything else, which is our own pages, the manifest fetching
   * its icons, and Next's image optimiser.
   *
   * ★ WHY NOT ALSO REFUSE REQUESTS WITH NO METADATA ★
   *
   * The first version did, and it broke the logo everywhere. `_next/image`
   * fetches the source file over HTTP from the server to itself, carrying no
   * browser fetch metadata — so the optimiser was handed a 404 and answered
   * "The requested resource isn't a valid image". Every brand image on the
   * site would have been blank.
   *
   * It also bought very little. Refusing bare requests stops `curl` with no
   * arguments and nothing else: one `-H "sec-fetch-dest: image"` defeats it.
   * Trading every logo on the site for an obstacle that costs an attacker one
   * header is not a trade worth making.
   *
   * ★ AND IT IS NOT A SEAL ★
   *
   * Nothing here makes the artwork un-downloadable, because nothing can. A
   * browser must receive the bytes to paint them: anyone with developer tools
   * has the file, and a screenshot needs no tools at all. This closes the
   * casual routes and stops other sites embedding our logo. It must never be
   * described as more than that.
   */
  if (request.nextUrl.pathname.startsWith('/brand/')) {
    const dest = request.headers.get('sec-fetch-dest');
    const site = request.headers.get('sec-fetch-site');

    if (!brandAssetAllowed(dest, site)) {
      /*
       * 404, not 403. A refusal saying "forbidden" advertises that there is
       * something here worth taking; "not found" ends the conversation. The
       * same reasoning as CloakAsNotFound on the API.
       */
      return new NextResponse(null, { status: 404 });
    }

    // Served, but never by a SHARED cache. A CDN caching this under the URL
    // alone would hand it to the next caller without the headers being checked.
    const asset = NextResponse.next();
    asset.headers.set('Cache-Control', 'private, max-age=3600');
    return asset;
  }

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
  /*
   * `brand/` was excluded here and is not any more.
   *
   * The exclusion was correct when this middleware only published a header —
   * running it in front of every image bought nothing. It now decides whether
   * brand assets may be served at all, so skipping them would leave the check
   * written and never executed, which is the worst of both.
   *
   * `_next/image` stays excluded: that is Next's optimiser fetching the file
   * server-side to resize it, and it does not send browser fetch metadata. It
   * is not a route a visitor can point at a file of their choosing.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|v1/).*)'],
};
