import { describe, it, expect } from 'vitest';
import { Permission } from '@grims/shared';
import { postLoginDestination, ONBOARDING_PATH, ADMIN_PATH, MEMBER_PATH } from './post-login-destination.js';

/**
 * Where a member lands after signing in.
 *
 * Human decision, 2026-07-27: securing an account must be an automatic flow the
 * first time an admin signs in, or when a member is promoted into an admin
 * rank — not a set of links they are told to go and find. A standard member
 * goes to their own dashboard and is prompted with a banner instead.
 *
 * ★ THIS IS ROUTING, NOT ENFORCEMENT ★
 *
 * Every test here decides where a browser is SENT. None of it keeps anybody
 * out: AdminGateGuard refuses the admin API without a confirmed second factor
 * whatever the browser does, so typing /app by hand gains nothing. If this file
 * were the security, the security would be a redirect — and a redirect is a
 * suggestion.
 */

const MEMBER = Permission.FORUM_VIEW_MEMBER | Permission.FLEET_EDIT_OWN;
const OFFICER = MEMBER | Permission.MEMBER_MANAGE;

describe('an admin who has not secured their account', () => {
  it('MANDATORY: goes to onboarding, not to the admin console', async () => {
    const to = await postLoginDestination({ mask: OFFICER, twoFactorEnrolled: false });
    expect(to).toBe(ONBOARDING_PATH);
  });

  it('MANDATORY: an explicit redirect does NOT skip onboarding', async () => {
    // The bypass to close. A ?redirect=/app on the sign-in link would otherwise
    // walk them straight past the thing they are required to do — and it is
    // exactly the URL somebody bookmarks.
    const to = await postLoginDestination({
      mask: OFFICER,
      twoFactorEnrolled: false,
      requested: '/app/roles',
    });
    expect(to).toBe(ONBOARDING_PATH);
  });

  it('applies the moment a member is PROMOTED, with no promotion-time hook', async () => {
    // Same member, same account, one more role. The obligation follows the
    // effective mask, so nothing has to notice the promotion happening.
    expect(await postLoginDestination({ mask: MEMBER, twoFactorEnrolled: false })).toBe(MEMBER_PATH);
    expect(await postLoginDestination({ mask: OFFICER, twoFactorEnrolled: false })).toBe(
      ONBOARDING_PATH,
    );
  });
});

describe('an admin who HAS secured their account', () => {
  it('goes to the admin console', async () => {
    const to = await postLoginDestination({ mask: OFFICER, twoFactorEnrolled: true });
    expect(to).toBe(ADMIN_PATH);
  });

  it('honours an explicit redirect once secured', async () => {
    // Now that the obligation is met, a deep link is just a deep link.
    const to = await postLoginDestination({
      mask: OFFICER,
      twoFactorEnrolled: true,
      requested: '/app/roles',
    });
    expect(to).toBe('/app/roles');
  });
});

describe('a standard member', () => {
  it('goes to their own dashboard', async () => {
    const to = await postLoginDestination({ mask: MEMBER, twoFactorEnrolled: false });
    expect(to).toBe(MEMBER_PATH);
  });

  it('MANDATORY: is never forced through onboarding', async () => {
    // Two-factor is an obligation for people who can affect others. Imposing it
    // on everyone is how it ends up switched off by whoever fields the
    // complaints — and then nobody has it.
    for (const enrolled of [true, false]) {
      expect(await postLoginDestination({ mask: MEMBER, twoFactorEnrolled: enrolled })).not.toBe(
        ONBOARDING_PATH,
      );
    }
  });

  it('honours an explicit redirect', async () => {
    const to = await postLoginDestination({
      mask: MEMBER,
      twoFactorEnrolled: false,
      requested: '/roster',
    });
    expect(to).toBe('/roster');
  });

  it('MANDATORY: a requested path is still allowlisted', async () => {
    // The requested value comes from a query string. Honouring it must not mean
    // trusting it — an absolute URL here would be an open redirect handed to a
    // freshly-authenticated browser.
    for (const evil of ['https://evil.example/x', '//evil.example', 'javascript:alert(1)']) {
      const to = await postLoginDestination({
        mask: MEMBER,
        twoFactorEnrolled: false,
        requested: evil,
      });
      expect(to, evil).toBe(MEMBER_PATH);
    }
  });
});

describe('the paths themselves', () => {
  it('are distinct and relative', () => {
    // Relative because the caller prefixes the configured site base. An
    // absolute path here would bypass that and hard-code an origin.
    for (const p of [ONBOARDING_PATH, ADMIN_PATH, MEMBER_PATH]) {
      expect(p.startsWith('/')).toBe(true);
      expect(p).not.toMatch(/^https?:|^\/\//);
    }
    expect(new Set([ONBOARDING_PATH, ADMIN_PATH, MEMBER_PATH]).size).toBe(3);
  });
});
