import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postLoginDestination, VERIFY_PATH, ADMIN_PATH } from './post-login-destination.js';
import { VERIFY_DISMISSED_COOKIE } from './verify-dismissal.js';
import { Permission, NO_PERMISSIONS } from '@grims/shared';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The verification prompt, over a whole session and the next one.
 *
 * ★ THE PROPERTY THAT MATTERS ★
 *
 * Dismissing means "not now". It must never be able to mean "never", because
 * nothing about the obligation has changed when somebody clicks an X.
 *
 * That holds only if THREE things line up: the cookie is session-scoped, logout
 * clears it, and the next sign-in routes them back to the page that fixes it.
 * Any one of them missing and the prompt quietly disappears forever — with no
 * error, no log, and an unverified admin who believes they dealt with it.
 */

const ADMIN = Permission.ROLE_MANAGE;

describe('where an unverified admin lands', () => {
  it('MANDATORY: on the page that fixes it, every time they sign in', async () => {
    expect(
      await postLoginDestination({ mask: ADMIN, twoFactorEnrolled: true, verified: false }),
    ).toBe(VERIFY_PATH);
  });

  it('MANDATORY: even when a bookmark asks for somewhere else', async () => {
    /*
     * `?redirect=/app` is exactly the URL somebody bookmarks and shares. If the
     * request won, the obligation would be one saved link away from never being
     * seen again.
     */
    expect(
      await postLoginDestination({
        mask: ADMIN,
        twoFactorEnrolled: true,
        verified: false,
        requested: '/app',
      }),
    ).toBe(VERIFY_PATH);
  });

  it('goes to the console once verified', async () => {
    expect(
      await postLoginDestination({ mask: ADMIN, twoFactorEnrolled: true, verified: true }),
    ).toBe(ADMIN_PATH);
  });

  it('MANDATORY: securing the account still comes first', async () => {
    // Two obligations at once. The second factor is the larger risk and wins;
    // verification is waiting for them on the sign-in after that.
    expect(
      await postLoginDestination({ mask: ADMIN, twoFactorEnrolled: false, verified: false }),
    ).toBe('/onboarding/security');
  });

  it('MANDATORY: an ordinary member is not sent here', async () => {
    /*
     * They are held at /onboarding/verification by the gate instead — a page
     * that explains the wait. Sending them to a settings tab they cannot act on
     * alone would be a worse answer to the same question.
     */
    const destination = await postLoginDestination({
      mask: NO_PERMISSIONS,
      twoFactorEnrolled: false,
      verified: false,
    });
    expect(destination).not.toBe(VERIFY_PATH);
  });

  it('is unaffected when the caller does not know the verification state', async () => {
    // `undefined` means "not asked", which must not be read as "not verified"
    // and bounce somebody who is perfectly fine.
    expect(await postLoginDestination({ mask: ADMIN, twoFactorEnrolled: true })).toBe(ADMIN_PATH);
  });
});

describe('the dismissal cannot outlive the session', () => {
  it('MANDATORY: logout clears the dismissal cookie', () => {
    /*
     * Without this, "dismissed for this session" is a lie: the member closes
     * the banner once and never sees it again on that browser, however many
     * times they sign in and out.
     */
    const controller = readFileSync(resolve(HERE, 'session.controller.ts'), 'utf8');

    const logout = controller.slice(controller.indexOf("@Post('logout')"));
    expect(logout).toContain('VERIFY_DISMISSED_COOKIE');
    expect(logout).toMatch(/clearCookie/);
  });

  it('MANDATORY: the cookie carries no expiry, so it dies with the browser too', () => {
    /*
     * Belt and braces around logout. Somebody who closes the browser without
     * signing out has ended their session as far as they are concerned, and the
     * prompt should agree with them.
     */
    const view = readFileSync(
      resolve(HERE, '..', '..', '..', 'web', 'src', 'components', 'verify-banner-view.tsx'),
      'utf8',
    );

    const setter = view.slice(view.indexOf('document.cookie'), view.indexOf('setDismissed(true)'));
    expect(setter).not.toMatch(/Max-Age|Expires/i);
  });

  it('MANDATORY: both sides agree on the cookie name', () => {
    /*
     * The API clears it and the browser sets it, from two files that cannot
     * import each other. A rename on one side alone would leave the browser
     * setting a cookie nothing ever clears — a permanent dismissal, silently.
     */
    const view = readFileSync(
      resolve(HERE, '..', '..', '..', 'web', 'src', 'components', 'verify-banner-view.tsx'),
      'utf8',
    );
    expect(view).toContain(`'${VERIFY_DISMISSED_COOKIE}'`);
  });
});
