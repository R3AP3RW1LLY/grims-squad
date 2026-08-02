import { describe, it, expect } from 'vitest';
import {
  Permission,
  ROLE_PRESETS,
  PERMISSION_NAMES,
  requiresTwoFactor,
  type PermissionMask,
} from '@grims/shared';
import { navFor } from './nav.js';

/**
 * The Shipyard's four permissions, and the one that nearly cost the squadron an authenticator each.
 *
 * ★ WHY THIS FILE EXISTS ★
 *
 * `SHIPYARD_SHARE_PUBLIC` spent an hour inside `PRIVILEGED_PERMISSIONS`, which reads well until you
 * notice `requiresTwoFactor` is built from that constant. The bit is in the member preset — the
 * owner asked for members to publish "if they choose to" — so the combination would have obliged
 * every member of the squadron to enrol a second factor in order to share a ship build.
 *
 * Nothing would have failed. No test was watching, no type was wrong, and the symptom would have
 * been a hundred people hitting an enrolment screen the next time they signed in.
 */

const has = (mask: PermissionMask, bit: PermissionMask): boolean => (mask & bit) === bit;

describe('Shipyard permissions', () => {
  it('sits on the bits it was allocated', () => {
    // Numbers, not names. A bit's VALUE is what every stored role mask is interpreted by, so
    // renumbering one silently changes what every existing role means.
    expect(Permission.SHIPYARD_VIEW).toBe(1n << 43n);
    expect(Permission.SHIPYARD_SAVE).toBe(1n << 44n);
    expect(Permission.SHIPYARD_SHARE).toBe(1n << 45n);
    expect(Permission.SHIPYARD_SHARE_PUBLIC).toBe(1n << 46n);
  });

  it('gives no two permissions the same bit', () => {
    // Two names on one bit is not a type error and not a test failure anywhere else: it merges two
    // gates into one, and granting either grants both.
    const byBit = new Map<string, string>();
    for (const name of PERMISSION_NAMES) {
      const bit = (Permission as unknown as Record<string, PermissionMask>)[name];
      const key = String(bit);
      expect(byBit.get(key), `${name} collides with ${byBit.get(key) ?? ''}`).toBeUndefined();
      byBit.set(key, name);
    }
  });

  it('lets a member plan, save and share — including publicly', () => {
    // Squadron owner: "the ability for our users to share their builds and make them visible to the
    // squadron and public if they choose to."
    const member = ROLE_PRESETS.member;

    expect(has(member, Permission.SHIPYARD_VIEW)).toBe(true);
    expect(has(member, Permission.SHIPYARD_SAVE)).toBe(true);
    expect(has(member, Permission.SHIPYARD_SHARE)).toBe(true);
    expect(has(member, Permission.SHIPYARD_SHARE_PUBLIC)).toBe(true);
  });

  it('does NOT oblige a member to enrol a second factor', () => {
    // ★ THE ONE THIS FILE WAS WRITTEN FOR ★
    //
    // If SHIPYARD_SHARE_PUBLIC (or any other bit every member holds) is ever added to
    // PRIVILEGED_PERMISSIONS, this fails — and the alternative to it failing is a hundred people
    // being marched into 2FA enrolment to share a ship build.
    expect(requiresTwoFactor(ROLE_PRESETS.member)).toBe(false);
    expect(requiresTwoFactor(ROLE_PRESETS.applicant)).toBe(false);
    expect(requiresTwoFactor(ROLE_PRESETS.guest)).toBe(false);

    // Officers still must, which is what the constant is actually for.
    expect(requiresTwoFactor(ROLE_PRESETS.officer)).toBe(true);
  });

  it('keeps the four separable, so one can be revoked alone', () => {
    // The whole reason for four bits instead of one: stopping somebody publishing must not stop
    // them planning a ship.
    const revoked = ROLE_PRESETS.member & ~Permission.SHIPYARD_SHARE_PUBLIC;

    expect(has(revoked, Permission.SHIPYARD_SHARE_PUBLIC)).toBe(false);
    expect(has(revoked, Permission.SHIPYARD_SHARE)).toBe(true);
    expect(has(revoked, Permission.SHIPYARD_VIEW)).toBe(true);
  });

  it('shows the Outfitter to SHIPYARD_VIEW and to nobody else', () => {
    expect(navFor(Permission.SHIPYARD_VIEW).some((i) => i.href === '/shipyard')).toBe(true);

    // Everything a member has EXCEPT the one bit. Proves the nav gates on this permission rather
    // than on being signed in, which is what it did before.
    const blind = ROLE_PRESETS.member & ~Permission.SHIPYARD_VIEW;
    expect(navFor(blind).some((i) => i.href === '/shipyard')).toBe(false);
    expect(navFor(0n).some((i) => i.href === '/shipyard')).toBe(false);
  });

  it('leaves the Outfitter inside the Shipyard subcategory under Squadron', () => {
    const item = navFor(ROLE_PRESETS.member).find((i) => i.href === '/shipyard');

    expect(item?.label).toBe('Outfitter');
    expect(item?.section).toBe('squadron');
    expect(item?.subsection).toBe('Shipyard');
  });
});
