import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The link from the app to Frontier.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * "whe i click connect with frontier in the companion app it sends me to the suqadron website not
 * frontier! ... I CAN NOT USE THE APP AT ALL"
 *
 * ★ THE SHAPE OF THE BUG ★
 *
 * `POST /v1/me/capi/start` existed and worked. NOTHING IN THE WEB APP EVER CALLED IT. The companion
 * opened /settings/privacy and expected the member to find a Connect button that had never been
 * built — so the mandatory step had no way to be completed by anybody, on any surface.
 *
 * Both halves are asserted here because either alone is the same dead end: a page that starts the
 * handshake but no app pointing at it, or an app pointing at a page that does nothing.
 */

const WEB = join(process.cwd(), 'src/app/(hub)/connect/frontier');
const MAIN = join(process.cwd(), '../companion/src/main.ts');

describe('the website can start the handshake', () => {
  const route = (): string => readFileSync(join(WEB, 'route.ts'), 'utf8');

  it('★ MANDATORY: it calls capiStart ★', () => {
    // The route that had no caller anywhere in the web app. This is the caller.
    expect(route()).toContain('/v1/me/capi/start');
  });

  it('★ MANDATORY: the redirect is decided on the SERVER ★', () => {
    /*
     * ★ THE BLACK SCREEN ★
     *
     * The first fix was a React page that called the API from the browser and then redirected.
     * Everything the member saw therefore depended on JavaScript running, hydration finishing and a
     * fetch resolving — and any one of those failing leaves a browser sitting on a document that has
     * rendered nothing. On screen that is indistinguishable from the app being broken.
     *
     * A route handler cannot reach that state: what leaves the server is a 302 or a page that says
     * what went wrong. Asserted as the absence of the client form, because "it happens to work now"
     * is exactly what the previous version also looked like.
     */
    /*
     * Comments stripped. The route's own header explains the blank page by naming
     * `window.location.replace`, and an assertion that reads prose fails on the wording rather than
     * on the code — the third time that trap has caught a test I wrote today, so it is worth the
     * two lines to close it properly.
     */
    const src = route().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

    expect(src).toContain('NextResponse.redirect(url, 302)');
    expect(src, 'a browser-side redirect is what produced the blank page').not.toContain(
      'window.location',
    );
    expect(src, 'and it must not be a client component').not.toContain("'use client'");
  });

  it('★ MANDATORY: an EMPTY url is refused rather than followed ★', () => {
    /*
     * The likely black screen itself. `window.location.replace('')` reloads the current page, so an
     * empty URL rendered nothing while looking like it had worked. Here it is said out loud.
     */
    expect(route()).toContain("if (url === '')");
  });

  it('★ MANDATORY: a signed-out browser is TOLD, not left blank ★', () => {
    // App paired, website not signed in, capiStart answers 401. Silence there is the same dead end
    // in a different place.
    const src = route();

    expect(src).toContain('You are not signed in to the website in this browser.');
    expect(src, 'the CSRF cookie differs between origins and a wrong one is a 403 that reads as signed-out').toContain(
      '__Host-gs_csrf',
    );
  });
});

describe('the app points at it', () => {
  it('★ MANDATORY: the companion opens /connect/frontier, not a settings page ★', () => {
    const src = readFileSync(MAIN, 'utf8');
    const handler = src.slice(src.indexOf("ipcMain.handle('connectFrontier'"));

    /*
     * Comments stripped first. The block above explains the old path by name, and an assertion that
     * reads prose passes or fails on the wording rather than on what the app opens — the same trap
     * that made an earlier IPC test green while the code underneath it was wrong.
     */
    const code = handler.slice(0, 2_400).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

    expect(code).toContain('/connect/frontier');
    expect(code, 'the settings page has no Connect button and never had one').not.toContain(
      '/settings/privacy',
    );
  });
});
