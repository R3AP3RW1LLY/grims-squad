import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { navFor, hasAdminArea } from './nav.js';
import { Permission, ROLE_PRESETS, NO_PERMISSIONS, ALL_PERMISSIONS } from '@grims/shared';

/**
 * What each member is shown.
 *
 * ★ NOT A SECURITY BOUNDARY, AND THE TESTS SAY SO ★
 *
 * Every route behind these links checks permissions again — a link is not an
 * authorisation, and hiding one protects nothing. What this protects is
 * HONESTY: a member must not be shown a menu item that will then refuse them,
 * because an interface that offers things it will not do teaches people to
 * distrust all of it.
 */

describe('what a signed-in member sees', () => {
  it('MANDATORY: an ordinary member gets their own settings', () => {
    /*
     * `requires: null` on the personal pages, deliberately. Your own privacy
     * settings are yours regardless of rank, and gating them on a permission is
     * a bug waiting for the first time somebody's roles get rebuilt — they
     * would lose the ability to change their own privacy.
     */
    const items = navFor(NO_PERMISSIONS);
    const hrefs = items.map((i) => i.href);

    /*
     * ★ PRIVACY AND SECURITY ARE TABS NOW, NOT NAV ENTRIES ★
     *
     * They moved onto Commander Management on 2026-07-28, so the assertion
     * follows them: what must be true is that an unranked member can REACH
     * their own settings, not that a particular href exists in the sidebar.
     *
     * The companion app keeps its own entry — it is software somebody
     * downloads, not a setting.
     */
    expect(hrefs).toContain('/settings/commander');
    expect(hrefs).toContain('/settings/devices');
    expect(hrefs).toContain('/dashboard');

    /*
     * That personal entries SURVIVE a no-permissions mask is itself the proof
     * they are ungated — navFor filters on `requires` and strips it from the
     * output, so there is no field left to assert on, and asserting on the
     * source list would test the data rather than the function.
     */
    const personal = items.filter((i) => i.section === 'personal');
    expect(personal.length).toBeGreaterThan(0);
  });

  it('MANDATORY: a member with no permissions sees no admin links', () => {
    expect(navFor(NO_PERMISSIONS).some((i) => i.section === 'admin')).toBe(false);
    expect(hasAdminArea(NO_PERMISSIONS)).toBe(false);
  });

  it('MANDATORY: never shows a link the member cannot use', () => {
    /*
     * The property that matters. Walked across every preset rather than spot
     * checked, because the failure is silent: a link appears, somebody clicks
     * it, and the page refuses them for reasons the interface just implied did
     * not apply.
     */
    for (const [roleName, mask] of Object.entries(ROLE_PRESETS)) {
      for (const item of navFor(mask as bigint)) {
        if (item.section === 'personal') continue; // always allowed, by design

        const gated = { '/ops': Permission.OPS_VIEW, '/bgs': Permission.BGS_VIEW, '/fleet': Permission.FLEET_VIEW };
        const required = gated[item.href as keyof typeof gated];
        if (required === undefined) continue;

        expect(((mask as bigint) & required) !== 0n, `${roleName} -> ${item.href}`).toBe(true);
      }
    }
  });
});

describe('the admin area', () => {
  it('MANDATORY: appears for someone who can manage roles', () => {
    expect(hasAdminArea(Permission.ROLE_MANAGE)).toBe(true);
  });

  it('MANDATORY: the roles link needs ROLE_MANAGE, not just any admin permission', () => {
    /*
     * The console itself opens to several permissions, but the individual pages
     * must not. Somebody who can read the audit log has no business being shown
     * the role editor — which is the screen that can grant permissions, and was
     * the site of a privilege-escalation bug earlier in this project.
     */
    const auditOnly = navFor(Permission.AUDIT_VIEW).map((i) => i.href);
    expect(auditOnly).toContain('/app/audit');
    expect(auditOnly).not.toContain('/app/roles');
    expect(auditOnly).not.toContain('/app/members');
  });

  it('MANDATORY: member management needs MEMBER_MANAGE specifically', () => {
    const roleOnly = navFor(Permission.ROLE_MANAGE).map((i) => i.href);
    expect(roleOnly).toContain('/app/roles');
    expect(roleOnly).not.toContain('/app/members');
  });

  it('somebody holding everything sees every section', () => {
    const sections = new Set(navFor(ALL_PERMISSIONS).map((i) => i.section));
    expect([...sections].sort()).toEqual(['admin', 'personal', 'squadron']);
  });
});

describe('the shape of each item', () => {
  it('every item has somewhere to go and something to say', () => {
    // The blurb is rendered on the dashboard cards. A missing one is an empty
    // card, which looks broken rather than sparse.
    for (const item of navFor(ALL_PERMISSIONS)) {
      expect(item.href, item.label).toMatch(/^\//);
      expect(item.label.length, item.href).toBeGreaterThan(0);
      expect(item.blurb.length, item.href).toBeGreaterThan(0);
    }
  });

  it('MANDATORY: no duplicate destinations', () => {
    // Two links to the same place in one sidebar reads as a rendering bug.
    const hrefs = navFor(ALL_PERMISSIONS).map((i) => i.href);
    expect(hrefs).toEqual([...new Set(hrefs)]);
  });
});

describe('an unsecured privileged account', () => {
  /*
   * ★ NO LINKS AT ALL UNTIL THE SECOND FACTOR IS SET ★
   *
   * The emptying happens in MeController rather than in navFor, because it is a
   * fact about the SESSION (are they enrolled) rather than about the mask (what
   * could they do). These tests pin the contract that makes it safe: navFor is
   * the single source every surface renders from, so emptying it there empties
   * the navbar, the sidebar and the account dropdown together.
   */
  it('MANDATORY: every authenticated surface renders from ONE list', () => {
    /*
     * If the navbar kept its own hardcoded links, emptying this would hide the
     * sidebar and leave the top bar advertising an admin console that will
     * refuse them. One list means one place to get it right.
     */
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'me.controller.ts'), 'utf8');

    expect(source).toMatch(/nav:\s*mustSecure\s*\?\s*\[\]\s*:\s*navFor\(mask\)/);
  });

  it('MANDATORY: is still reported AS an admin, so the UI can explain why', () => {
    // isAdmin stays truthful. Lying about it would leave them looking at a
    // "secure your account" prompt with no idea which account or why.
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'me.controller.ts'), 'utf8');

    expect(source).toContain('isAdmin: hasAdminArea(mask)');
  });
});
