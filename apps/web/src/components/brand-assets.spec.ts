import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brandAssetAllowed } from '../middleware';

/**
 * Who may fetch the squadron's artwork.
 *
 * ★ WHAT WAS ASKED FOR, AND WHAT IS POSSIBLE ★
 *
 * Squadron owner, 2026-07-29: the logo assets must not be downloadable from the
 * website.
 *
 * A server cannot deliver that, and it is important this file says so rather
 * than implying the box is ticked. A browser must RECEIVE an image to paint it:
 * by the time anybody sees the logo the bytes are in their cache, their network
 * panel and their page source. Anyone with developer tools has the file, and a
 * screenshot needs no tools at all.
 *
 * What is enforceable is the two routes that matter in practice — opening the
 * file directly, and another site hotlinking it — and that is what these tests
 * pin.
 */
describe('brandAssetAllowed', () => {
  it('refuses the address bar and "open image in new tab"', () => {
    // A navigation TO the file. The most obvious way to get at it, and the one
    // somebody tries first.
    expect(brandAssetAllowed('document', 'none')).toBe(false);
    expect(brandAssetAllowed('document', 'same-origin')).toBe(false);
  });

  it('refuses another site hotlinking our artwork', () => {
    expect(brandAssetAllowed('image', 'cross-site')).toBe(false);
  });

  it('serves our own pages', () => {
    expect(brandAssetAllowed('image', 'same-origin')).toBe(true);
  });

  /*
   * ★ THE ONE THAT BROKE THE SITE ★
   *
   * The first version refused requests with no fetch metadata. `_next/image`
   * fetches the source file over HTTP from the server to itself and sends none,
   * so the optimiser received a 404 and answered "The requested resource isn't
   * a valid image" — every brand image on the site went blank, while the markup
   * still contained the correct URL.
   *
   * If this test fails, the logo is broken everywhere and the page source will
   * look perfectly fine.
   */
  it('MANDATORY: serves the image optimiser, which sends no fetch metadata', () => {
    expect(brandAssetAllowed(null, null)).toBe(true);
  });

  it('serves the PWA manifest fetching its icons', () => {
    // Browsers vary here — some send `image`, some `empty`. Both are us.
    expect(brandAssetAllowed('image', 'same-origin')).toBe(true);
    expect(brandAssetAllowed('empty', 'same-origin')).toBe(true);
  });

  /*
   * Stated as a test so nobody later reads the middleware and concludes the
   * artwork is sealed. Refusing bare requests would stop `curl` with no
   * arguments and nothing else — one header defeats it — and it is exactly what
   * broke the optimiser. The trade was made deliberately.
   */
  it('does NOT pretend to stop a client that sets its own headers', () => {
    expect(brandAssetAllowed('image', null)).toBe(true);
  });
});

/**
 * The middleware has to actually RUN on these paths.
 *
 * `brand/` was excluded from the matcher back when this middleware only
 * published a request header — running it in front of every image bought
 * nothing. Now it decides whether brand assets may be served at all, so an
 * exclusion would leave the rule above written, tested, and never executed.
 */
describe('the matcher reaches brand assets', () => {
  const src = readFileSync(join(__dirname, '..', 'middleware.ts'), 'utf8');
  const matcher = /matcher:\s*\[([^\]]*)\]/.exec(src)?.[1] ?? '';

  it('MANDATORY: does not exclude brand/', () => {
    expect(matcher).not.toContain('brand/');
  });

  it('still skips the static and API paths it should', () => {
    for (const skipped of ['_next/static', '_next/image', 'favicon.ico', 'v1/']) {
      expect(matcher).toContain(skipped);
    }
  });
});

/**
 * Social cards and favicons must NOT live under /brand/.
 *
 * ★ WHY THIS IS WORTH ASSERTING ★
 *
 * Discord, Twitter and Facebook fetch the share image as a bare cross-site
 * request. If the OG card were served from /brand/ the rule above would refuse
 * it, and every link anybody posted to the squadron would lose its preview —
 * with nothing on the site looking broken.
 *
 * They are Next file-convention routes (`/opengraph-image.jpg`, `/icon.png`)
 * and are unaffected. This test exists so that stays true.
 */
describe('share and icon assets stay outside /brand/', () => {
  const layout = readFileSync(join(__dirname, '..', 'app', 'layout.tsx'), 'utf8');

  it('the root metadata does not point openGraph or icons at /brand/', () => {
    const meta = layout.slice(layout.indexOf('export const metadata'), layout.indexOf('export const viewport'));
    expect(meta).not.toContain('/brand/');
  });
});
