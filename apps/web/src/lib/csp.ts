/**
 * The Content Security Policy (INV-035).
 *
 * ★ A PURE FUNCTION, SO THE PRODUCTION POLICY IS TESTED ON A DEVELOPER'S MACHINE ★
 *
 * The policy genuinely has to differ between environments — Next's dev server needs
 * `'unsafe-eval'` for React Fast Refresh, and shipping that to production would undo a
 * large part of what a CSP is for. That is a real difference, unlike the environment
 * branch this project refused to put in an authorisation path.
 *
 * The danger is the same though: a policy built inline in middleware means the string
 * production serves is one nobody ever looks at, and the first time anybody sees it is
 * when a browser blocks something in front of a member. So the policy is a function of an
 * explicit `dev` flag, and `csp.spec.ts` asserts the PRODUCTION string in full — including
 * that it does not contain `unsafe-eval` — while running in a test environment.
 *
 * ★ WHY A NONCE AND NOT `'unsafe-inline'` FOR SCRIPTS ★
 *
 * The forum stores HTML that members wrote. It is sanitised before storage, and the
 * sanitiser is well tested — but INV-035 asks for a strict CSP *as well*, and the reason is
 * that these are independent layers. `'unsafe-inline'` on script-src would mean a single
 * sanitiser bug becomes script execution; a nonce means it does not, because an injected
 * `<script>` has no way to guess the nonce.
 *
 * Next.js reads the nonce out of the CSP header on the REQUEST and applies it to the script
 * tags it emits, which is why middleware sets the header in both directions.
 */

/**
 * Directives that never vary, whatever the environment.
 *
 * Each one is here because of a specific thing it stops, and the comment says which — a
 * policy nobody can explain is a policy that gets widened the first time something breaks.
 */
export interface CspOptions {
  /** The per-request nonce, base64. */
  readonly nonce: string;
  /** True only for `next dev`. Adds what Fast Refresh needs and nothing else. */
  readonly dev: boolean;
}

export function buildCsp({ nonce, dev }: CspOptions): string {
  const directives: string[] = [
    // Nothing loads unless a later directive allows it. The default is the backstop for
    // every resource type not named below, including ones added to the platform later.
    `default-src 'self'`,

    /*
     * Scripts: our own origin plus this request's nonce.
     *
     * `'strict-dynamic'` is deliberately NOT here. It would let a nonced script load
     * further scripts without a nonce, which is convenient for tag managers and is exactly
     * the transitive trust we have no use for — every script in this app is one we ship.
     *
     * `'unsafe-eval'` in dev only: React Fast Refresh cannot work without it. That is the
     * one real difference between the two policies, and the spec asserts it is absent from
     * production.
     */
    dev
      ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}'`,

    /*
     * Styles allow inline, and that is a considered trade rather than an oversight.
     *
     * Tailwind emits a stylesheet, but a handful of components set `style={{ fontFamily:
     * 'var(--font-display)' }}` — attribute styles, which need `style-src-attr
     * 'unsafe-inline'`. Nonces cannot apply to style attributes at all, so the only
     * alternative is removing every inline style from the app.
     *
     * The exposure from inline CSS is real but narrow: CSS cannot execute script in any
     * supported browser, and the sanitiser refuses `style` and `class` on member content,
     * so a post cannot inject CSS in the first place. Script execution is the thing being
     * defended, and that is nonce-gated.
     */
    `style-src 'self' 'unsafe-inline'`,
    `style-src-attr 'unsafe-inline'`,

    /*
     * Images: our own origin, plus data: for the few inline SVG icons.
     *
     * NO remote hosts. Member-uploaded images are served from our own API, and Discord
     * avatars are copied onto our storage rather than hotlinked — deliberately, so
     * rendering the roster does not tell Discord which members are being looked at. A
     * permissive img-src would quietly undo that.
     */
    `img-src 'self' data:`,

    // Fonts are self-hosted. A CDN here would leak a request per visitor to a third party.
    `font-src 'self'`,

    /*
     * XHR/fetch/WebSocket. `'self'` covers the API, which the browser reaches on the same
     * origin through Caddy. In dev the Next server also opens a websocket for HMR.
     */
    dev ? `connect-src 'self' ws: wss:` : `connect-src 'self'`,

    /*
     * ★ THE THREE THAT INV-035 NAMES, AND WHAT EACH ACTUALLY PREVENTS ★
     *
     * frame-ancestors 'none'  nobody may put this site in an iframe. Clickjacking: an
     *                         attacker overlays an invisible copy of our page and
     *                         harvests clicks on real controls. Strictly stronger than
     *                         X-Frame-Options and not overridable by it.
     * object-src 'none'       no Flash, no applets, no <embed>. A legacy plugin surface
     *                         with no legitimate use here.
     * base-uri 'self'         an injected <base href> would silently repoint every
     *                         relative URL on the page — including form actions and
     *                         script sources — at somebody else's server.
     */
    `frame-ancestors 'none'`,

    /*
     * ★ THE ONE NARROW ALLOWANCE, AND WHY IT IS NARROW ★
     *
     * `frame-src` was `'none'` and stayed that way for everything except a video a reader has
     * explicitly clicked (P2.3). The stored HTML contains NO iframe: it holds a placeholder, and
     * `YouTubeConsent` creates the frame on click.
     *
     * So for any reader who does not click, this directive is never exercised — no request to
     * Google, nothing reported about who read the page. That matters more than usual here: this
     * squadron includes minors (D15), and the protective defaults that decision set are the reason
     * click-to-play was chosen over an inline player.
     *
     * `youtube-nocookie.com` ONLY. Not `youtube.com`, not a wildcard — the nocookie host serves the
     * same player without setting tracking cookies on first load, and naming exactly one host means
     * this cannot become a general "allow embeds" hole later.
     */
    `frame-src https://www.youtube-nocookie.com`,
    `object-src 'none'`,
    `base-uri 'self'`,

    /*
     * Forms may only submit to us. Without this, an injected form could post a member's
     * input to another origin and the browser would help it.
     */
    `form-action 'self'`,

    /*
     * Upgrades http subresources to https. Omitted in dev, where the whole site is http on
     * localhost and this would break every asset.
     */
    ...(dev ? [] : [`upgrade-insecure-requests`]),
  ];

  return directives.join('; ');
}

/**
 * A fresh nonce.
 *
 * `crypto.getRandomValues` rather than `Math.random`: a guessable nonce is not a nonce, and
 * it is the single value the whole script policy rests on. 16 bytes is 128 bits, which is
 * far beyond what an attacker could brute force within one request's lifetime.
 *
 * Web Crypto rather than `node:crypto`, because middleware runs on the Edge runtime where
 * the Node module is not available — a detail that only shows up at runtime.
 */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // btoa over a binary string: available in both the Edge runtime and Node 24.
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
