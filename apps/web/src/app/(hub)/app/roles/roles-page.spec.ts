import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HIERARCHICAL_ROLES, ROLE_PRESETS, maskToString, type RoleKey } from '@grims/shared';
import { ALL_PERMISSIONS, DESCRIBES, countPermissions, maskDiff } from './role-editor';
import { groupRoles, LEADERSHIP_CEILING, LADDER_CEILING } from './role-groups';
import { rolePresets } from './role-presets';
import type { AdminRoleRow } from '../../../../lib/api';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../../../../..');

/**
 * The roles console.
 *
 * ★ EVERY ROLE EDITABLE, EVERY PERMISSION EXPLAINED ★
 *
 * Both are squadron-owner instructions and both fail SILENTLY if they regress:
 * a role dropped by the grouping simply is not on the page, and a permission
 * with no description is an unlabelled checkbox that somebody ticks anyway.
 */

const role = (over: Partial<AdminRoleRow> = {}): AdminRoleRow => ({
  id: over.key ?? 'r',
  key: 'r',
  name: 'R',
  permMask: '0',
  rankOrder: 100,
  isHierarchical: true,
  ...over,
});

describe('permission descriptions', () => {
  it('MANDATORY: every permission on the page has one', () => {
    // An unexplained checkbox in a permissions editor is one somebody ticks
    // without knowing what it does.
    const missing = ALL_PERMISSIONS.map(([name]) => name).filter(
      (name) => (DESCRIBES[name] ?? '').trim() === '',
    );
    expect(missing).toEqual([]);
  });

  it('MANDATORY: describes every permission the SSOT defines', () => {
    /*
     * ssot/04-contracts/permissions.ts is the authority. A bit added there and
     * not here would appear on this page as a checkbox with no sentence beside
     * it — or, worse, not appear at all.
     */
    const ssot = readFileSync(resolve(REPO, 'ssot/04-contracts/permissions.ts'), 'utf8');
    const declared = [...ssot.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*1n\s*<<\s*(\d+)n,/gm)].map(
      (m) => m[1] as string,
    );

    expect(declared.length).toBeGreaterThan(0);
    const shown = new Set(ALL_PERMISSIONS.map(([name]) => name));
    expect(declared.filter((d) => !shown.has(d))).toEqual([]);
  });

  it('MANDATORY: the bit numbers match the SSOT exactly', () => {
    // The mask is stored, so a wrong bit here silently re-points every saved
    // permission on the platform.
    const ssot = readFileSync(resolve(REPO, 'ssot/04-contracts/permissions.ts'), 'utf8');
    const bits = new Map(
      [...ssot.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*1n\s*<<\s*(\d+)n,/gm)].map((m) => [
        m[1] as string,
        Number(m[2]),
      ]),
    );

    for (const [name, bit] of ALL_PERMISSIONS) {
      expect(bits.get(name), `${name} bit`).toBe(bit);
    }
  });

  it('descriptions are sentences, not restatements of the constant', () => {
    for (const [name] of ALL_PERMISSIONS) {
      const text = DESCRIBES[name] ?? '';
      expect(text.length, `${name} is too terse to help`).toBeGreaterThan(20);
      expect(text, `${name} just repeats itself`).not.toBe(name);
    }
  });
});

describe('grouping roles', () => {
  it('MANDATORY: never drops a role', () => {
    /*
     * Every role must be editable — squadron owner. A role the grouping does
     * not claim would vanish from the only page that can change its
     * permissions, and nothing would say so.
     */
    const roles = [
      role({ key: 'a', rankOrder: 10 }),
      role({ key: 'b', rankOrder: 190 }),
      role({ key: 'c', rankOrder: 900, isHierarchical: false }),
      role({ key: 'd', rankOrder: 1000, isHierarchical: false }),
      // Deliberately odd: a band nothing above covers.
      role({ key: 'e', rankOrder: 500, isHierarchical: false }),
    ];

    const grouped = groupRoles(roles);
    const seen = grouped.flatMap((g) => g.roles.map((r) => r.key)).sort();
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('MANDATORY: admin ranks run most senior FIRST', () => {
    /*
     * Appointments DESCEND — Galactic Admiral is 10, Squadron Leader 60. Sorting
     * them the same way as the tenure ladder is the bug that once titled the
     * Galactic Admiral "Squadron Leader" on every officer's card.
     */
    const grouped = groupRoles([
      role({ key: 'leader', name: 'Squadron Leader', rankOrder: 60 }),
      role({ key: 'admiral', name: 'Galactic Admiral', rankOrder: 10 }),
    ]);

    const leadership = grouped.find((g) => g.key === 'leadership');
    expect(leadership?.roles.map((r) => r.name)).toEqual(['Galactic Admiral', 'Squadron Leader']);
  });

  it('MANDATORY: general ranks run TOP of the ladder first', () => {
    // Tenure ASCENDS — Cadet is 100, Grand Master General 190 — so top-first is
    // the reverse of the appointments above.
    const grouped = groupRoles([
      role({ key: 'cadet', name: 'Cadet', rankOrder: 100 }),
      role({ key: 'gmg', name: 'Grand Master General', rankOrder: 190 }),
    ]);

    const ranks = grouped.find((g) => g.key === 'ranks');
    expect(ranks?.roles.map((r) => r.name)).toEqual(['Grand Master General', 'Cadet']);
  });

  it('puts members, allies and unranked in their own group', () => {
    const grouped = groupRoles([
      role({ key: 'grims_squad_members', name: "Grim's Squad members", rankOrder: 900, isHierarchical: false }),
      role({ key: 'allies', name: 'Allies', rankOrder: 910, isHierarchical: false }),
      role({ key: 'unranked', name: 'Unranked', rankOrder: 999, isHierarchical: false }),
      role({ key: 'webmaster', name: 'Webmaster', rankOrder: 1000, isHierarchical: false }),
    ]);

    const membership = grouped.find((g) => g.key === 'membership');
    expect(membership?.roles.map((r) => r.name)).toEqual([
      "Grim's Squad members",
      'Allies',
      'Unranked',
    ]);

    // The webmaster is a WEBSITE role and is kept apart: it confers every
    // permission here and no standing in the squadron at all.
    expect(grouped.find((g) => g.key === 'platform')?.roles.map((r) => r.name)).toEqual([
      'Webmaster',
    ]);
  });

  it('MANDATORY: founding roles get their own band, not the platform one', () => {
    /*
     * Squadron owner, 2026-08-04. The founding roles carry the titles the roster
     * prints and the order the founders sit in, so they have to be editable —
     * and neither neighbouring band would describe them honestly. "Members,
     * allies and unranked" is everyone who holds no ladder rank, and the
     * founders all hold one; the platform heading says its roles "confer every
     * permission on this site and no standing in the squadron whatsoever",
     * which is the exact opposite of what these are.
     */
    const grouped = groupRoles([
      role({ key: 'co_founder', name: 'Co-Founder', rankOrder: 810, isHierarchical: false }),
      role({ key: 'founder', name: 'Founder', rankOrder: 800, isHierarchical: false }),
      role({ key: 'roster_pin', name: 'Roster pin', rankOrder: 820, isHierarchical: false }),
      role({ key: 'grims_squad_members', name: "Grim's Squad members", rankOrder: 900, isHierarchical: false }),
      role({ key: 'webmaster', name: 'Webmaster', rankOrder: 1000, isHierarchical: false }),
    ]);

    // Ascending, like the appointments: the founder carries the lowest number.
    expect(grouped.find((g) => g.key === 'founding')?.roles.map((r) => r.key)).toEqual([
      'founder',
      'co_founder',
      'roster_pin',
    ]);
    expect(grouped.find((g) => g.key === 'membership')?.roles.map((r) => r.key)).toEqual([
      'grims_squad_members',
    ]);
    expect(grouped.find((g) => g.key === 'platform')?.roles.map((r) => r.key)).toEqual([
      'webmaster',
    ]);
  });

  it('omits a group with nothing in it', () => {
    // An empty "General ranks" heading invites the reader to wonder what is
    // missing.
    const grouped = groupRoles([role({ key: 'a', rankOrder: 10 })]);
    expect(grouped.map((g) => g.key)).toEqual(['leadership']);
  });

  it('the two ceilings do not overlap', () => {
    expect(LEADERSHIP_CEILING).toBeLessThan(LADDER_CEILING);
  });
});

/**
 * Applying a role preset.
 *
 * ★ WHY THIS IS SPECIFIED AND NOT JUST WRITTEN ★
 *
 * A preset is a one-click change to what a hundred members may do. Three things have to hold, and
 * every one of them fails silently if it regresses: the list must be the permission model's own
 * bundles rather than a hand-typed copy that drifts; the masks must cross to the browser as
 * decimal STRINGS, because SITE_CONFIG is 1n<<63n and a JSON number would arrive rounded into a
 * plausible-looking different set (INV-006); and the control must stage bits for Preview and Save
 * rather than writing anything itself.
 */
describe('role presets', () => {
  const presets = rolePresets();

  it('MANDATORY: the list handed to the client IS ROLE_PRESETS — same keys, same order', () => {
    /*
     * Derived, never listed. A bundle added to ssot/04-contracts/permissions.ts and missing here
     * would be a set of permissions the console can only reproduce by ticking it out from memory,
     * which is the exact problem this control removes.
     */
    expect(presets.map((p) => p.key)).toEqual(Object.keys(ROLE_PRESETS));
  });

  it('MANDATORY: every mask is the shared constant, exactly', () => {
    for (const p of presets) {
      const key = p.key as RoleKey;
      expect(p.mask, `${p.key} mask`).toBe(maskToString(ROLE_PRESETS[key]));
      // And it round-trips as a bigint, which is how the editor parses it.
      expect(BigInt(p.mask), `${p.key} round trip`).toBe(ROLE_PRESETS[key]);
    }
  });

  it('MANDATORY: masks travel as decimal STRINGS, never numbers (INV-006)', () => {
    for (const p of presets) {
      expect(typeof p.mask, `${p.key} is a ${typeof p.mask}`).toBe('string');
      expect(p.mask, `${p.key} is not decimal`).toMatch(/^\d+$/);
    }

    /*
     * The reason, demonstrated rather than asserted in prose: `sysadmin` carries SITE_CONFIG at
     * 1n<<63n, so its mask cannot survive a trip through a JavaScript number at all. If this ever
     * became a number on the wire, the browser would receive a rounded mask, tick a plausible set
     * of boxes, and save it.
     */
    const sysadmin = presets.find((p) => p.key === 'sysadmin');
    expect(sysadmin).toBeDefined();
    expect(Number.isSafeInteger(Number(sysadmin?.mask))).toBe(false);
    expect(BigInt(Number(sysadmin?.mask))).not.toBe(BigInt(sysadmin?.mask ?? '0'));
  });

  it('MANDATORY: every bit in every preset has a checkbox on this page', () => {
    /*
     * Otherwise applying a preset would stage a permission the editor cannot render — granted on
     * save, invisible on screen, and impossible to take off again from here.
     */
    const shown = ALL_PERMISSIONS.reduce((mask, [, bit]) => mask | (1n << BigInt(bit)), 0n);
    for (const [key, mask] of Object.entries(ROLE_PRESETS)) {
      expect(mask & ~shown, `${key} carries a bit the page does not render`).toBe(0n);
    }
  });

  it('marks the ladder rungs as hierarchical and the rest as tags', () => {
    for (const p of presets) {
      expect(p.hierarchical, p.key).toBe(HIERARCHICAL_ROLES.includes(p.key as RoleKey));
    }
    // Both groups exist, so neither heading in the control is ever empty by construction.
    expect(presets.some((p) => p.hierarchical)).toBe(true);
    expect(presets.some((p) => !p.hierarchical)).toBe(true);
  });

  it('every preset carries a name and a sentence, like every checkbox does', () => {
    for (const p of presets) {
      expect(p.name.trim(), `${p.key} name`).not.toBe('');
      expect(p.name, `${p.key} name is the raw key`).not.toBe(p.key);
      expect(p.blurb.length, `${p.key} is too terse to help`).toBeGreaterThan(20);
    }
  });

  it('MANDATORY: applying a preset stages exactly its bits — additions AND removals', () => {
    /*
     * A preset is the WHOLE bundle. Applying `member` to a role that holds FORUM_MODERATE takes
     * moderation away, and the panel has to say so — a diff that showed only additions would read
     * as "grant these as well" while quietly revoking.
     */
    const officer = BigInt(presets.find((p) => p.key === 'officer')?.mask ?? '0');
    const member = BigInt(presets.find((p) => p.key === 'member')?.mask ?? '0');

    const down = maskDiff(officer, member);
    expect(down.adds).toEqual([]);
    expect(down.removes).toContain('FORUM_MODERATE');
    expect(down.removes).toContain('MEMBER_MANAGE');

    const up = maskDiff(member, officer);
    expect(up.removes).toEqual([]);
    expect(up.adds).toContain('FORUM_MODERATE');

    // Every name in either direction is a permission this page actually renders.
    const shown = new Set(ALL_PERMISSIONS.map(([name]) => name));
    for (const name of [...up.adds, ...down.removes]) expect(shown.has(name)).toBe(true);
  });

  it('MANDATORY: applying to a zero role stages the bundle and nothing else', () => {
    /*
     * The case the membership migration left waiting: `grims_squad_members`, `allies` and
     * `unranked` all seeded at zero, on purpose, "because a migration that quietly granted the
     * whole squadron a permission bundle nobody chose would be a privilege escalation dressed as
     * a feature."
     */
    const member = BigInt(presets.find((p) => p.key === 'member')?.mask ?? '0');
    const diff = maskDiff(0n, member);
    expect(diff.removes).toEqual([]);
    expect(diff.adds.length).toBe(countPermissions(member));
    expect(diff.adds).toContain('FORUM_VIEW_MEMBER');
    // Nothing from the Administration group rides along in the member bundle.
    expect(diff.adds).not.toContain('ROLE_MANAGE');
    expect(diff.adds).not.toContain('SITE_CONFIG');
  });

  it('a preset applied to a role that already holds it stages nothing', () => {
    const member = BigInt(presets.find((p) => p.key === 'member')?.mask ?? '0');
    expect(maskDiff(member, member)).toEqual({ adds: [], removes: [] });
  });

  it('MANDATORY: choosing a preset writes NOTHING — the save path is untouched', () => {
    /*
     * The whole safety of this control. A preset that posted straight to the API would be a
     * one-click permission grant for a hundred members with nothing on screen between the click
     * and the consequence — no preview naming who is affected, and no audited save.
     *
     * Read from the source, because the property is "there is no third network call in this file"
     * and no amount of exercising the two that exist can prove that.
     */
    const editor = readFileSync(resolve(HERE, 'role-editor.tsx'), 'utf8');

    const calls = editor.match(/apiPost</g) ?? [];
    expect(calls, 'a network call was added to the role editor').toHaveLength(2);
    expect(editor).toContain('/v1/admin/roles/${selected.id}/preview');
    expect(editor).toContain('/v1/admin/roles/${selected.id}`');
    // Save is still impossible before a preview — the editor's oldest rule.
    expect(editor).toContain('disabled={busy || preview === null || preview.unchanged}');
    // And applying a preset invalidates any preview on screen, like a hand tick does.
    expect(editor).toMatch(/function applyPreset[\s\S]{0,600}setPreview\(null\)/);
  });

  it('MANDATORY: the editor never imports the shared barrel to get these', () => {
    /*
     * `@grims/shared`'s index re-exports `nonce.service`, which imports `node:crypto`. A client
     * component that reaches it fails the webpack build with UnhandledSchemeError and takes every
     * hub page to a 500. lib/client-imports.spec.ts guards this generally; asserted here too
     * because the obvious way to write a preset control is the way that breaks the site.
     */
    const editor = readFileSync(resolve(HERE, 'role-editor.tsx'), 'utf8');
    expect(editor).not.toMatch(/from\s+['"]@grims\/shared['"]/);
    expect(editor).not.toMatch(/from\s+['"]\.\/role-presets['"]/);

    // And the module that DOES import it is only ever pulled by the server component.
    const page = readFileSync(resolve(HERE, 'page.tsx'), 'utf8');
    expect(page).toContain("from './role-presets'");
    expect(page).not.toMatch(/^\s*['"]use client['"]/m);
  });
});
