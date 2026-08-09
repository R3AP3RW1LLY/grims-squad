import { describe, expect, it } from 'vitest';
import { Permission, ROLE_PRESETS, computeEffectiveMask } from '@grims/shared';
import { navDeniedFor, navFor } from './nav.js';

/**
 * ★ SQUADRON OWNER, 2026-08-09 ★
 *
 * "why are the operations and BGS panels are not being protected by the roles and permissions. we
 * need this addressed and fixed! we literally have these rules in place but those pages are still
 * appearing for everyone even though permissions are not granted!"
 *
 * ★ WHAT WAS ACTUALLY WRONG, BECAUSE IT IS NOT WHAT IT LOOKED LIKE ★
 *
 * The rules were in place and two of the three things that need them were already doing it. The
 * sidebar hid the link (`navFor`), and the API refused the data with a cloak-404 (`ops.controller`,
 * `bgs.controller`) — so no squadron information was ever served to a member without the
 * permission.
 *
 * The PAGE had no check at all. `(hub)/layout.tsx` enforced only that somebody was signed in, on
 * the stated grounds that the API is the security boundary. That is true of the DATA and false of
 * the page: typing `/ops` drew the whole shell, and the refused fetch rendered "could not load the
 * operations board" — which reads as a broken site, not as a page that is not yours.
 *
 * ★ WHY THE DENIAL LIST IS DERIVED AND NOT WRITTEN DOWN AGAIN ★
 *
 * A page guard maintained separately from the sidebar is a second copy of the same rule, and it
 * would drift the first time a permission moved — invisibly, because a page that wrongly ALLOWS
 * looks exactly like one that correctly allows. These tests pin the property that matters: for any
 * mask, a page is denied exactly when its link is hidden.
 */

const mask = (...roles: Array<keyof typeof ROLE_PRESETS>) =>
  computeEffectiveMask(roles.map((r) => ROLE_PRESETS[r]));

describe('a page is reachable exactly when its sidebar link is', () => {
  const ROLES: Array<keyof typeof ROLE_PRESETS> = [
    'guest',
    'applicant',
    'member',
    'bgs_team',
    'officer',
  ];

  for (const role of ROLES) {
    it(`★ MANDATORY: ${role} — nothing is both hidden and reachable ★`, () => {
      const m = mask(role);
      const visible = new Set(navFor(m).map((i) => i.href));
      const denied = new Set(navDeniedFor(m));

      for (const href of denied) {
        expect(
          visible.has(href),
          `${href} is denied to ${role} but still rendered in their sidebar — the two rules disagree`,
        ).toBe(false);
      }
      for (const href of visible) {
        expect(
          denied.has(href),
          `${href} is in ${role}'s sidebar but the layout would answer 404 for it`,
        ).toBe(false);
      }
    });
  }
});

describe('the two panels the owner reported', () => {
  it('★ MANDATORY: a mask without OPS_VIEW is denied /ops ★', () => {
    // The guest mask holds no OPS_VIEW. Before this existed, /ops rendered for anybody signed in.
    const guest = mask('guest');
    expect(guest & Permission.OPS_VIEW).toBe(0n);
    expect(navDeniedFor(guest)).toContain('/ops');
  });

  it('★ MANDATORY: a mask without BGS_VIEW is denied /bgs ★', () => {
    const guest = mask('guest');
    expect(guest & Permission.BGS_VIEW).toBe(0n);
    expect(navDeniedFor(guest)).toContain('/bgs');
  });

  it('a full member keeps both, because the member preset grants them', () => {
    /*
     * ★ WORTH STATING PLAINLY, BECAUSE IT IS THE OTHER HALF OF THE REPORT ★
     *
     * `MEMBER` includes OPS_VIEW, OPS_SIGNUP, BGS_VIEW and BGS_REPORT by design, so every member of
     * the squadron sees Operations and BGS and always has. If those panels should be officer-only,
     * that is a change to the PRESET and not to any guard — and it is a decision about how the
     * squadron runs, so it is not one to make quietly inside a bug fix.
     */
    const member = mask('member');
    expect(navDeniedFor(member)).not.toContain('/ops');
    expect(navDeniedFor(member)).not.toContain('/bgs');
  });
});

describe('the denial list is safe to send to a browser', () => {
  it('MANDATORY: carries hrefs and nothing else', () => {
    // `requires` is a permission mask and must never leave the server — the same rule navFor
    // follows by listing its fields instead of spreading them.
    for (const entry of navDeniedFor(mask('guest'))) {
      expect(typeof entry).toBe('string');
      expect(entry.startsWith('/'), `${entry} is not a path`).toBe(true);
    }
  });

  it('never denies a page that everybody is allowed', () => {
    /*
     * Items with `requires: null` are the personal pages — your own settings are yours regardless of
     * rank. If one ever appeared in this list the layout would 404 a member out of their own
     * account settings, which is a far worse failure than the one being fixed.
     */
    const denied = navDeniedFor(0n);
    for (const href of navFor(0n).map((i) => i.href)) {
      expect(denied, `${href} is ungated yet appears in the denial list`).not.toContain(href);
    }
  });
});
