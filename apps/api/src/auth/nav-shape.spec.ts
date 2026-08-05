import { describe, it, expect } from 'vitest';
import { Permission, type PermissionMask } from '@grims/shared';
import { navFor, type NavItem } from './nav.js';

/**
 * The nav survives the trip to the browser intact.
 *
 * ★ WHY THIS FILE EXISTS ★
 *
 * `subsection` was added to `NavItem`, set on the Shipyard entry, and rendered correctly by a
 * sidebar that had its own passing tests — and the feature was still dead. `navFor` rebuilds each
 * item field by field to keep the permission mask out of the response, and nobody added the new
 * field to that list. Every layer was individually right; the value never crossed the boundary.
 *
 * So these tests do not check any one field. They check that whatever the definitions carry is what
 * comes out, which is the only version of this that keeps working when somebody adds the next one.
 */

const ALL: PermissionMask = Object.values(Permission).reduce<PermissionMask>(
  (acc, bit) => acc | bit,
  0n,
);

/** Fields a member is meant to see. `requires` is deliberately absent — see below. */
const DISPLAY_FIELDS = ['href', 'label', 'section', 'blurb'] as const;

describe('navFor', () => {
  it('carries every display field that the definitions set', () => {
    const items = navFor(ALL);
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      for (const field of DISPLAY_FIELDS) {
        expect(item[field], `${item.href} lost ${field}`).toBeDefined();
      }
    }
  });

  it('carries subsection for the items that have one', () => {
    /*
     * Named rather than derived. Reading the expectation out of the same NAV table it is checking
     * would pass no matter what `navFor` did with the field — which is precisely the failure this
     * file was written for.
     */
    const outfitter = navFor(ALL).find((i) => i.href === '/shipyard');

    expect(outfitter).toBeDefined();
    expect(outfitter?.subsection).toBe('Shipyard');
    expect(outfitter?.section).toBe('squadron');
  });

  it('omits subsection rather than sending it undefined', () => {
    // `{"subsection": undefined}` and an absent key are different shapes over JSON, and the sidebar
    // groups on the key's presence.
    const dashboard = navFor(ALL).find((i) => i.href === '/dashboard');

    expect(dashboard).toBeDefined();
    expect(Object.hasOwn(dashboard as object, 'subsection')).toBe(false);
  });

  it('never leaks the permission mask', () => {
    // The reason navFor rebuilds items by hand instead of spreading. If this ever fails, the fix is
    // NOT to delete the key — it is that some field is being copied wholesale.
    for (const item of navFor(ALL)) {
      expect(Object.hasOwn(item, 'requires'), `${item.href} leaked requires`).toBe(false);
    }
  });

  it('gives a member with no permissions only ungated items', () => {
    /*
     * `/shipyard` used to be asserted here, because it shipped ungated. It is gated on
     * SHIPYARD_VIEW as of 2026-08-01 — the owner asked for Shipyard permissions that "work the same
     * as all other categories" — so a zero mask must NOT see it. `shipyard-permissions.spec.ts`
     * covers that bit specifically.
     */
    const items = navFor(0n);

    expect(items.map((i) => i.href)).not.toContain('/shipyard');
    expect(items.every((i) => i.section !== 'admin')).toBe(true);

    // The personal pages stay reachable on an empty mask: your own settings are yours regardless of
    // rank, and gating them is a bug waiting for the first role rebuild.
    expect(items.map((i) => i.href)).toContain('/settings/commander');
  });

  it('places every subsection inside exactly one section', () => {
    // A subcategory name reused across two sections would render as two separate groups that look
    // like one, and the stored open/closed state — keyed on the name alone — would drive both.
    const sections = new Map<string, Set<NavItem['section']>>();

    for (const item of navFor(ALL)) {
      if (item.subsection === undefined) continue;
      const seen = sections.get(item.subsection) ?? new Set();
      seen.add(item.section);
      sections.set(item.subsection, seen);
    }

    for (const [name, inSections] of sections) {
      expect([...inSections], `subsection "${name}" spans sections`).toHaveLength(1);
    }
  });
});
