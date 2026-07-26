import { describe, it, expect } from 'vitest';
import {
  Permission as P,
  ROLE_PRESETS,
  NO_PERMISSIONS,
  ALL_PERMISSIONS,
  hasPermission,
  hasAnyPermission,
  computeEffectiveMask,
  describePermissions,
  maskFromNames,
  maskToString,
  maskFromString,
  missingPermissions,
  rolesGranting,
} from './permissions.js';

describe('permission bitmask', () => {
  it('@INV-006 SITE_CONFIG exceeds the signed 64-bit range', () => {
    // 1n << 63n = 9223372036854775808, one PAST int8 max. This is why the
    // column is NUMERIC(40,0) and not BIGINT.
    expect(P.SITE_CONFIG).toBe(9223372036854775808n);
    expect(P.SITE_CONFIG).toBeGreaterThan(9223372036854775807n);
  });

  it('@INV-006 TELEMETRY_WRITE sits beyond 2^64 entirely', () => {
    expect(P.TELEMETRY_WRITE).toBeGreaterThan(2n ** 64n);
  });

  it('@INV-006 round-trips the full mask through string transport exactly', () => {
    expect(maskFromString(maskToString(ALL_PERMISSIONS))).toBe(ALL_PERMISSIONS);
  });

  it('@INV-006 never emits a JSON number for a mask', () => {
    // Number(mask) would silently lose precision above 2^53.
    const s = maskToString(ROLE_PRESETS.sysadmin);
    expect(typeof s).toBe('string');
    expect(s).toMatch(/^\d+$/);
    expect(BigInt(s)).toBe(ROLE_PRESETS.sysadmin);
  });

  it('rejects a malformed mask rather than coercing it', () => {
    expect(() => maskFromString('12.5')).toThrow();
    expect(() => maskFromString('-1')).toThrow();
    expect(() => maskFromString('abc')).toThrow();
  });

  it('every permission occupies a distinct bit', () => {
    const values = Object.values(P);
    expect(new Set(values).size).toBe(values.length);
    // OR of all must equal ALL_PERMISSIONS - proves no overlap swallowed a bit.
    expect(values.reduce((a, b) => a | b, 0n)).toBe(ALL_PERMISSIONS);
  });
});

describe('hasPermission', () => {
  it('treats a compound requirement as AND, not OR', () => {
    const both = P.FORUM_VIEW_OFFICER | P.FORUM_MODERATE;
    expect(hasPermission(ROLE_PRESETS.member, both)).toBe(false);
    expect(hasPermission(ROLE_PRESETS.officer, both)).toBe(true);
  });

  it('hasAnyPermission is the explicit OR form', () => {
    const either = P.FORUM_VIEW_OFFICER | P.FORUM_VIEW_MEMBER;
    expect(hasAnyPermission(ROLE_PRESETS.member, either)).toBe(true);
    expect(hasPermission(ROLE_PRESETS.member, either)).toBe(false);
  });

  it('an empty requirement is trivially satisfied', () => {
    expect(hasPermission(NO_PERMISSIONS, 0n)).toBe(true);
  });
});

describe('computeEffectiveMask', () => {
  it('@INV-001 ORs the granted role masks', () => {
    const m = computeEffectiveMask([ROLE_PRESETS.member, ROLE_PRESETS.bgs_team]);
    expect(hasPermission(m, P.FORUM_VIEW_MEMBER)).toBe(true);
    expect(hasPermission(m, P.BGS_REPORT)).toBe(true);
  });

  it('@INV-007 deny beats grant, for every permission group', () => {
    for (const perm of [
      P.FORUM_MODERATE, P.OPS_MANAGE, P.CARRIER_MANAGE,
      P.BGS_SET_ORDERS, P.TRADE_QUERY, P.AI_TOOLS_ADMIN,
      P.MEMBER_MANAGE, P.TELEMETRY_WRITE,
    ]) {
      const granted = computeEffectiveMask([ROLE_PRESETS.sysadmin]);
      expect(hasPermission(granted, perm)).toBe(true);
      const denied = computeEffectiveMask([ROLE_PRESETS.sysadmin], perm);
      expect(hasPermission(denied, perm)).toBe(false);
    }
  });

  it('@INV-037 a non-active account resolves to NO permissions', () => {
    for (const status of ['left', 'banned', 'inactive'] as const) {
      const m = computeEffectiveMask([ROLE_PRESETS.sysadmin], 0n, status);
      expect(m).toBe(NO_PERMISSIONS);
      expect(hasPermission(m, P.FORUM_VIEW_PUBLIC)).toBe(false);
    }
  });

  it('@INV-037 an active account is unaffected by the status gate', () => {
    expect(computeEffectiveMask([ROLE_PRESETS.officer], 0n, 'active')).toBe(ROLE_PRESETS.officer);
  });
});

describe('role presets — the ring boundaries', () => {
  it('guest and applicant cannot see member content', () => {
    expect(hasPermission(ROLE_PRESETS.guest, P.FORUM_VIEW_MEMBER)).toBe(false);
    expect(hasPermission(ROLE_PRESETS.applicant, P.FORUM_VIEW_MEMBER)).toBe(false);
  });

  it('a member cannot moderate, manage members, or set BGS orders', () => {
    for (const perm of [P.FORUM_MODERATE, P.MEMBER_MANAGE, P.BGS_SET_ORDERS, P.OPS_MANAGE]) {
      expect(hasPermission(ROLE_PRESETS.member, perm)).toBe(false);
    }
  });

  it('an officer cannot manage roles — only command and above', () => {
    expect(hasPermission(ROLE_PRESETS.officer, P.ROLE_MANAGE)).toBe(false);
    expect(hasPermission(ROLE_PRESETS.commander, P.ROLE_MANAGE)).toBe(true);
  });

  it('only sysadmin holds SITE_CONFIG and AI_TOOLS_ADMIN', () => {
    expect(rolesGranting(P.SITE_CONFIG)).toEqual(['sysadmin']);
    expect(rolesGranting(P.AI_TOOLS_ADMIN)).toEqual(['sysadmin']);
  });

  it('@INV-046 orthogonal tags confer no rank', () => {
    // A carrier owner or miner is not thereby an officer.
    for (const tag of ['miner', 'combat_wing', 'explorer'] as const) {
      expect(hasPermission(ROLE_PRESETS[tag], P.FORUM_VIEW_MEMBER)).toBe(false);
      expect(hasPermission(ROLE_PRESETS[tag], P.FORUM_MODERATE)).toBe(false);
    }
  });

  it('the hierarchy is genuinely nested, not merely ordered', () => {
    const chain = [
      ROLE_PRESETS.guest, ROLE_PRESETS.applicant, ROLE_PRESETS.member,
      ROLE_PRESETS.wing_lead, ROLE_PRESETS.officer, ROLE_PRESETS.commander,
      ROLE_PRESETS.sysadmin,
    ];
    for (let i = 1; i < chain.length; i++) {
      const lower = chain[i - 1]!;
      const higher = chain[i]!;
      expect(hasPermission(higher, lower)).toBe(true);
    }
  });
});

describe('introspection helpers', () => {
  it('describePermissions round-trips the full mask', () => {
    expect(describePermissions(ALL_PERMISSIONS)).toHaveLength(Object.keys(P).length);
    expect(describePermissions(NO_PERMISSIONS)).toEqual([]);
  });

  it('maskFromNames throws on an unknown name rather than dropping it silently', () => {
    expect(maskFromNames(['FORUM_MODERATE'])).toBe(P.FORUM_MODERATE);
    expect(() => maskFromNames(['NOT_A_PERMISSION'])).toThrow(/Unknown permission/);
  });

  it('missingPermissions powers an actionable error message', () => {
    const need = P.FORUM_VIEW_OFFICER | P.FORUM_MODERATE;
    expect(missingPermissions(ROLE_PRESETS.member, need).sort()).toEqual([
      'FORUM_MODERATE',
      'FORUM_VIEW_OFFICER',
    ]);
    expect(missingPermissions(ROLE_PRESETS.officer, need)).toEqual([]);
  });
});
