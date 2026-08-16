import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * The one link that takes a member from the app to Frontier.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * First: "whe i click connect with frontier in the companion app it sends me to the suqadron website
 * not frontier!" — the app opened /settings/privacy, where no Connect button had ever been built.
 *
 * Then, after the first fix: "ITS STILL NOT OPENING THE FRONTIER LOGIN ITS JUST TAKING US TO A
 * FUCKING BLACK SCREEN!"
 *
 * ★ WHY THE FIRST FIX COULD SHOW A BLANK PAGE, AND THIS CANNOT ★
 *
 * That version was a React page that called the API from the BROWSER and then redirected. Everything
 * a member sees therefore depended on JavaScript running, hydration completing, and a fetch
 * resolving — and any one of those failing leaves the browser sitting on a page that has rendered
 * nothing. There is no way to tell that apart from "the app is broken", because on screen it is
 * identical.
 *
 * A route handler has none of that surface. The redirect is decided on the server, before anything
 * is sent, and what reaches the browser is a 302 to Frontier or a page that says what went wrong.
 * There is no state in which it can render an empty document.
 *
 * ★ WHY IT CANNOT SIMPLY BE A LINK ★
 *
 * The authorisation URL is per member and carries a PKCE challenge the hub has to remember, so it
 * only exists after `POST /v1/me/capi/start`. That call is session-authenticated, and the companion
 * deliberately holds no session — its identity is a device token, a far smaller credential than a
 * cookie that can act as the member anywhere on the site. The browser has the session; the app does
 * not. So the browser makes the call.
 */

/** Same resolution the rest of the server-side calls use. */
const SERVER_API = process.env['API_INTERNAL_URL'] ?? 'http://api:3000';

/**
 * A page that explains itself, for the cases where there is nothing to redirect to.
 *
 * Deliberately not a redirect to a settings page: the member arrived here from the app, and bouncing
 * them somewhere else with no explanation is how the original bug felt from the outside.
 */
function problemPage(message: string, status: number): NextResponse {
  const esc = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Connect with Frontier</title>
<style>body{font:14px/1.6 ui-sans-serif,system-ui,sans-serif;background:#0b0f14;color:#e6edf3;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
main{max-width:44ch;text-align:center}h1{font-size:15px;letter-spacing:.18em;text-transform:uppercase;color:#ff7a7a;margin:0 0 12px}
a{color:#ff9d3f}</style></head><body><main>
<h1>Frontier sign-in</h1><p>${esc}</p>
<p>Sign in to the website in this browser, then press <strong>Connect with Frontier</strong> in the app again.</p>
<p><a href="/dashboard">Go to your dashboard</a></p>
</main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const jar = await cookies();
  const cookieHeader = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  if (cookieHeader === '') {
    return problemPage('You are not signed in to the website in this browser.', 401);
  }

  /*
   * The CSRF token is a cookie the API also expects echoed as a header. Read here rather than
   * assumed, because the two cookie names differ between a secure origin and a development one and
   * sending the wrong one is a 403 that looks exactly like being signed out.
   */
  const csrf = jar.get('__Host-gs_csrf')?.value ?? jar.get('gs_csrf')?.value ?? '';

  let res: Response;
  try {
    res = await fetch(`${SERVER_API}/v1/me/capi/start`, {
      method: 'POST',
      headers: { cookie: cookieHeader, 'x-csrf-token': csrf, accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return problemPage('We could not reach the hub to start the Frontier sign-in.', 502);
  }

  if (!res.ok) {
    return problemPage(
      res.status === 401
        ? 'You are not signed in to the website in this browser.'
        : `The hub refused to start the Frontier sign-in (${res.status}).`,
      res.status === 401 ? 401 : 502,
    );
  }

  const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === 'string' ? body.url : '';

  /*
   * An empty URL was the black screen. `window.location.replace('')` reloads the current page, so
   * the old client version could sit in a loop rendering nothing while looking like it had worked.
   * Checked here, where it can be SAID instead.
   */
  if (url === '') {
    return problemPage('The hub did not return a Frontier sign-in link.', 502);
  }

  return NextResponse.redirect(url, 302);
}
