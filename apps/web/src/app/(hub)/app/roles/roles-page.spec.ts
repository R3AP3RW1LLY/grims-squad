import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_PERMISSIONS, DESCRIBES } from './role-editor';
import { groupRoles, LEADERSHIP_CEILING, LADDER_CEILING } from './role-groups';
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
