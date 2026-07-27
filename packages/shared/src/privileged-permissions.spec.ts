import { describe, it, expect } from 'vitest';
import {
  Permission,
  PRIVILEGED_PERMISSIONS,
  requiresTwoFactor,
  describePermissions,
} from './permissions.js';

/**
 * Which permissions oblige a member to secure their account.
 *
 * ★ THE TEST FOR MEMBERSHIP OF THIS SET ★
 *
 * Not "does it feel administrative". The question is: CAN HOLDING THIS AFFECT
 * SOMEBODY OTHER THAN YOURSELF, OR THE SITE? If yes, a stolen Discord account
 * for this member is other people's problem, and one factor is not enough.
 *
 * These tests pin both directions, because the expensive mistakes are
 * symmetrical: too narrow leaves a privileged account on one factor, too wide
 * forces two-factor on 108 people who only ever edit their own loadout — and
 * the second one gets the rule deleted by whoever fields the complaints.
 */
describe('PRIVILEGED_PERMISSIONS', () => {
  it('MANDATORY: includes everything that can affect other members', () => {
    for (const name of [
      'MEMBER_MANAGE',
      'ROLE_MANAGE',
      'AUDIT_VIEW',
      'SITE_CONFIG',
      'AI_TOOLS_ADMIN',
      'FORUM_MODERATE',
      'OPS_MANAGE',
      'BGS_SET_ORDERS',
      'FLEET_APPROVE_DOCTRINE',
    ] as const) {
      expect(PRIVILEGED_PERMISSIONS & Permission[name], name).not.toBe(0n);
    }
  });

  it('MANDATORY: excludes everything that only affects yourself', () => {
    // Forcing two-factor on an ordinary member is how the whole rule ends up
    // being switched off by somebody tired of the complaints.
    for (const name of [
      'FORUM_VIEW_PUBLIC',
      'FORUM_POST_PUBLIC',
      'FORUM_VIEW_MEMBER',
      'FLEET_EDIT_OWN',
      'OPS_SIGNUP',
      'TRADE_QUERY',
      'AI_CHAT',
      'TELEMETRY_WRITE',
    ] as const) {
      expect(PRIVILEGED_PERMISSIONS & Permission[name], name).toBe(0n);
    }
  });

  it('MANDATORY: is a union, not a "bits above 60" rule', () => {
    // TELEMETRY_WRITE is bit 70 and is NOT privileged, so any rule phrased as
    // a threshold would capture it — and would capture whatever is allocated
    // next, silently.
    expect(Permission.TELEMETRY_WRITE > Permission.SITE_CONFIG).toBe(true);
    expect(PRIVILEGED_PERMISSIONS & Permission.TELEMETRY_WRITE).toBe(0n);
  });

  it('handles bits beyond 2^53 without losing precision', () => {
    // SITE_CONFIG is 1n<<63n. A Number here would round it away and quietly
    // stop requiring two-factor of the single most dangerous permission.
    expect(requiresTwoFactor(Permission.SITE_CONFIG)).toBe(true);
  });
});

describe('requiresTwoFactor', () => {
  it('is false for an ordinary member', () => {
    const member =
      Permission.FORUM_VIEW_PUBLIC | Permission.FORUM_POST_MEMBER | Permission.FLEET_EDIT_OWN;
    expect(requiresTwoFactor(member)).toBe(false);
  });

  it('is true the moment ANY privileged bit appears', () => {
    const member = Permission.FORUM_VIEW_PUBLIC | Permission.FLEET_EDIT_OWN;
    expect(requiresTwoFactor(member)).toBe(false);
    expect(requiresTwoFactor(member | Permission.FORUM_MODERATE)).toBe(true);
  });

  it('MANDATORY: answers from the EFFECTIVE mask, so promotion needs no hook', () => {
    /*
     * This is what makes "when a member is promoted to an admin rank" work
     * without a promotion-time trigger anywhere. The obligation is a function
     * of what they hold RIGHT NOW, so gaining a role starts it and losing one
     * ends it — with nothing to remember and nothing to migrate.
     */
    const before = Permission.FORUM_VIEW_MEMBER;
    const afterPromotion = before | Permission.MEMBER_MANAGE;

    expect(requiresTwoFactor(before)).toBe(false);
    expect(requiresTwoFactor(afterPromotion)).toBe(true);
    // ...and demotion reverses it, with no cleanup step.
    expect(requiresTwoFactor(afterPromotion & ~Permission.MEMBER_MANAGE)).toBe(false);
  });

  it('is false for no permissions at all', () => {
    expect(requiresTwoFactor(0n)).toBe(false);
  });

  it('names the offending permissions, for the UI to explain WHY', () => {
    // "Secure your account" with no reason is an instruction. Naming what they
    // hold makes it an explanation, and people comply with explanations.
    const held = Permission.FORUM_VIEW_MEMBER | Permission.FORUM_MODERATE;
    expect(describePermissions(held & PRIVILEGED_PERMISSIONS)).toEqual(['FORUM_MODERATE']);
  });
});
