/**
 * An error a BROWSER can read, rather than the envelope a program wants.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "we jsut got this error: {"error":{"code":"INTERNAL_ERROR" ... }} no error screen! what the
 * fuck! we want error screens instead of showing this shit."
 *
 * They were right the first time and right again, and the error pages added to the website could
 * never have fixed it. Next's `error.tsx` catches a failure while REACT renders. This JSON came
 * from the API — `GET /v1/auth/discord/callback`, which is a URL the browser navigates to directly
 * as the last leg of signing in. Next is not involved at any point, so no boundary of its can
 * intervene, and the member is shown the envelope meant for a program.
 *
 * ★ CONTENT NEGOTIATION, WHICH IS WHAT THE HEADER IS FOR ★
 *
 * The companion app, the website's own server-side fetches and every script want JSON and must
 * keep getting it — `retryable` and `retryAfterSeconds` are a contract, and the app reads them. A
 * browser navigating says `Accept: text/html` and wants a page. One response shape per audience,
 * decided by the thing that already declares which audience it is.
 *
 * ★ SELF-CONTAINED, BECAUSE THE SITE MAY BE THE THING THAT IS DOWN ★
 *
 * No stylesheet, no font, no script. This is served when something has already gone wrong, quite
 * possibly the very thing that would serve those assets, and a page that needs a second request to
 * look right is a page that will sometimes not look right.
 */

/** Escapes text for HTML. Everything interpolated below is ours, and this is not a place to assume. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ErrorPageInput {
  readonly status: number;
  /** Shown to the member. Already safe — the filter never passes an internal message through. */
  readonly message: string;
  readonly requestId: string;
  /** Where "back to the hub" goes. */
  readonly siteUrl: string;
}

/**
 * Whether this request came from somebody looking at a screen.
 *
 * A browser navigation sends `Accept: text/html,...`. `fetch()` defaults to `Accept: * / *` and
 * our own clients ask for JSON explicitly, so the test is deliberately narrow: HTML must be named,
 * and named ahead of JSON when both appear.
 */
export function wantsHtml(accept: string | undefined): boolean {
  if (accept === undefined || accept === '') return false;
  const lower = accept.toLowerCase();
  const html = lower.indexOf('text/html');
  if (html === -1) return false;
  const json = lower.indexOf('application/json');
  return json === -1 || html < json;
}

/**
 * The page itself.
 *
 * Deliberately the same words and shape as the website's own error screens, so a member who hits
 * one and then the other does not think they have found two different broken sites. It cannot
 * literally share that component — this is a Fastify reply from a Nest process that has no React
 * in it — so what it shares is the language.
 */
export function errorPage(input: ErrorPageInput): string {
  const retryable = input.status >= 500;
  const site = input.siteUrl.replace(/\/+$/, '');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(retryable ? 'Something went wrong' : 'That did not work')} — Grim's Squad</title>
<style>
  :root { color-scheme: dark }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #07090c; color: #c9d3dd; padding: 2rem;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  .card { max-width: 34rem; text-align: center }
  .eyebrow {
    margin: 0; font-size: 11px; letter-spacing: .32em; text-transform: uppercase;
    color: #4fd2e8; font-family: ui-monospace, monospace;
  }
  h1 { margin: .75rem 0 0; font-size: clamp(1.5rem, 4vw, 2rem); color: #ff8c42; line-height: 1.15 }
  .rule { width: 6rem; height: 1px; margin: 1.25rem auto 0; background: #2a3440 }
  p { margin: 1.5rem 0 0; font-size: .9rem; line-height: 1.6 }
  .actions { margin-top: 2rem; display: flex; gap: .75rem; justify-content: center; flex-wrap: wrap }
  a.btn {
    border: 1px solid #2a3440; color: #c9d3dd; padding: .65rem 1.25rem; border-radius: 4px;
    font-family: ui-monospace, monospace; font-size: 12px; letter-spacing: .24em;
    text-transform: uppercase; text-decoration: none;
  }
  a.btn.primary { border-color: #4fd2e8; color: #4fd2e8 }
  .ref { margin-top: 2rem; font-size: 11px; opacity: .7; font-family: ui-monospace, monospace }
  .ref span { color: #e8eef4 }
</style>
</head>
<body>
  <div class="card">
    <p class="eyebrow">${esc(retryable ? 'Something went wrong' : 'That did not work')}</p>
    <h1>${esc(retryable ? 'THE HUB HAD A PROBLEM' : 'THAT REQUEST WAS NOT ACCEPTED')}</h1>
    <div class="rule"></div>
    <p>${esc(input.message)}</p>
    ${
      retryable
        ? '<p>This is usually temporary — the hub may be updating, or busy. Nothing about your account has changed.</p>'
        : ''
    }
    <div class="actions">
      <a class="btn primary" href="${esc(site)}/">Back to the hub</a>
      <a class="btn" href="${esc(site)}/v1/auth/discord">Sign in again</a>
    </div>
    <p class="ref">Reference <span>${esc(input.requestId)}</span></p>
  </div>
</body>
</html>`;
}
