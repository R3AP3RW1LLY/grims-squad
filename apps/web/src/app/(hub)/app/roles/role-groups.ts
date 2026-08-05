import type { AdminRoleRow } from '../../../../lib/api';

/**
 * How the console arranges roles.
 *
 * ★ THE TWO LADDERS RUN OPPOSITE WAYS, AND THAT HAS BITTEN US ★
 *
 * Leadership appointments DESCEND: Galactic Admiral is 10 and Squadron Leader
 * is 60, so the most senior has the LOWEST number. Tenure ranks ASCEND: Cadet
 * is 100 and Grand Master General is 190.
 *
 * Sorting both the same way is what once titled the Galactic Admiral "Squadron
 * Leader" on every officer's card. Each group therefore names its own direction
 * rather than sharing a comparator, and both read top-of-ladder first on screen.
 *
 * ★ NO ROLE MAY BE INVISIBLE ★
 *
 * Every role has to be editable, so `groupRoles` ends with a catch-all. A role
 * added later with an unfamiliar rankOrder appears under "Other" rather than
 * vanishing from a page whose whole purpose is to edit permissions — a missing
 * role here is a permission nobody can see or change.
 */

/** Below this is a leadership APPOINTMENT; at or above it is a tenure RANK. */
export const LEADERSHIP_CEILING = 100;

/**
 * At or above this a role is FOUNDING standing: honour, not a ladder position
 * and not a website role.
 *
 * Its own band because neither neighbour would describe it honestly. The
 * membership band is "everyone who holds no ladder rank", and the founders all
 * hold one; the platform band above says its roles "confer every permission on
 * this site and no standing in the squadron whatsoever", which is the exact
 * opposite of what these are.
 */
export const FOUNDING_FLOOR = 800;

/** At or above this a role is membership or platform, not a ladder position. */
export const LADDER_CEILING = 900;

/** At or above this a role is about the WEBSITE, not the squadron. */
export const PLATFORM_FLOOR = 1000;

export interface RoleGroup {
  readonly key: string;
  readonly title: string;
  readonly blurb: string;
  readonly roles: readonly AdminRoleRow[];
}

export function groupRoles(all: readonly AdminRoleRow[]): RoleGroup[] {
  const rest = new Set(all);
  const take = (pick: (r: AdminRoleRow) => boolean, sort: (a: AdminRoleRow, b: AdminRoleRow) => number) => {
    const got = [...rest].filter(pick).sort(sort);
    for (const r of got) rest.delete(r);
    return got;
  };

  // Ascending: 10 is the top of this ladder.
  const leadership = take(
    (r) => r.isHierarchical && r.rankOrder < LEADERSHIP_CEILING,
    (a, b) => a.rankOrder - b.rankOrder,
  );

  // Descending: 190 is the top of this one.
  const ranks = take(
    (r) => r.isHierarchical && r.rankOrder < LADDER_CEILING,
    (a, b) => b.rankOrder - a.rankOrder,
  );

  /*
   * Ascending, like the appointments and for the same reason: the founder is the
   * most senior and carries the lowest number. Taken BEFORE membership so a
   * founding role can never be swept into "everyone who holds no ladder rank".
   */
  const founding = take(
    (r) => r.rankOrder >= FOUNDING_FLOOR && r.rankOrder < LADDER_CEILING && !r.isHierarchical,
    (a, b) => a.rankOrder - b.rankOrder,
  );

  const membership = take(
    (r) => r.rankOrder >= LADDER_CEILING && r.rankOrder < PLATFORM_FLOOR,
    (a, b) => a.rankOrder - b.rankOrder,
  );

  const platform = take(
    (r) => r.rankOrder >= PLATFORM_FLOOR,
    (a, b) => a.rankOrder - b.rankOrder,
  );

  const groups: RoleGroup[] = [
    {
      key: 'leadership',
      title: 'Admin ranks',
      blurb:
        'Leadership appointments, most senior first. These carry admin access, and every one of them can be edited here.',
      roles: leadership,
    },
    {
      key: 'ranks',
      title: 'General ranks',
      blurb:
        'The promotion ladder, top to bottom. Earned by qualifying months — time served, never moderation power (INV-046).',
      roles: ranks,
    },
    {
      key: 'founding',
      title: 'Founders',
      blurb:
        'Who founded the squadron, and what their card calls them. The name here is the title shown on the roster, and the order decides who sits where at the top of it — both are edited on this page.',
      roles: founding,
    },
    {
      key: 'membership',
      title: 'Members, allies and unranked',
      blurb:
        'Everyone who holds no ladder rank. This is where the floor is set: what an ordinary member, an ally, or somebody brand new may actually do.',
      roles: membership,
    },
    {
      key: 'platform',
      title: 'Platform',
      blurb:
        'Website roles. They confer every permission on this site and no standing in the squadron whatsoever.',
      roles: platform,
    },
  ];

  /*
   * Anything the bands above did not claim. Empty in normal operation — and if
   * it is ever not empty, that is exactly the thing an admin needs to see.
   */
  if (rest.size > 0) {
    groups.push({
      key: 'other',
      title: 'Other',
      blurb:
        'Roles that do not fall into any band above. Shown so nothing on this page is invisible.',
      roles: [...rest].sort((a, b) => a.rankOrder - b.rankOrder),
    });
  }

  return groups.filter((g) => g.roles.length > 0);
}
