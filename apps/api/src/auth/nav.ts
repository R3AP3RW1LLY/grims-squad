import { Permission, hasAnyPermission, type PermissionMask } from '@grims/shared';

/**
 * What a member can actually reach, decided on the SERVER.
 *
 * ★ WHY THE SERVER DECIDES, AND NOT THE BROWSER ★
 *
 * The navigation could be built client-side from a permission mask, and that
 * would be one fewer thing here. It would also mean shipping the whole
 * permission model to every visitor and trusting a bigint comparison in
 * somebody else's browser to decide what an admin link looks like.
 *
 * This is not a security boundary — every route behind these links checks
 * permissions again, and must, because a link is not an authorisation. It is an
 * HONESTY boundary: a member should not see a menu item that will refuse them.
 * Deciding it here means the menu and the guard read the same mask from the
 * same source, and cannot drift.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
  /** Groups items under a heading in the sidebar. */
  readonly section: 'squadron' | 'personal' | 'admin';
  /** A one-line description, for the dashboard cards. */
  readonly blurb: string;
}

interface NavDefinition extends NavItem {
  /** Any ONE of these is enough. `null` means everybody signed in. */
  readonly requires: PermissionMask | null;
}

/**
 * Every authenticated destination, and what it takes to reach it.
 *
 * Ordered as it is rendered. `requires: null` is deliberate for the personal
 * pages: your own settings are yours regardless of rank, and gating them on a
 * permission would be a bug waiting to happen the first time somebody's roles
 * were rebuilt.
 */
const NAV: readonly NavDefinition[] = [
  // ---- squadron ------------------------------------------------------------
  {
    href: '/dashboard',
    label: 'Dashboard',
    section: 'squadron',
    blurb: 'Where you stand, and what needs doing.',
    requires: null,
  },
  {
    href: '/roster',
    label: 'Roster',
    section: 'squadron',
    blurb: 'Who flies with the squadron.',
    requires: null,
  },
  {
    href: '/ops',
    label: 'Operations',
    section: 'squadron',
    blurb: 'Wings forming up, and what they need.',
    requires: Permission.OPS_VIEW,
  },
  {
    href: '/bgs',
    label: 'BGS',
    section: 'squadron',
    blurb: 'The faction, its systems, and this week’s orders.',
    requires: Permission.BGS_VIEW,
  },
  {
    href: '/fleet',
    label: 'Fleet',
    section: 'squadron',
    blurb: 'Ships, builds, and what the doctrine asks for.',
    requires: Permission.FLEET_VIEW,
  },

  // ---- personal ------------------------------------------------------------
  {
    href: '/settings/commander',
    label: 'Commander management',
    section: 'personal',
    blurb: 'Your name, verification, privacy, security and account.',
    requires: null,
  },
  {
    href: '/settings/devices',
    label: 'Companion app',
    section: 'personal',
    blurb: 'Pair a device and choose what it sends.',
    requires: null,
  },
  /*
   * ★ PRIVACY, SECURITY AND ACCOUNT ARE TABS NOW ★
   *
   * They were three more entries here and three more routes. Answering "how is
   * my account set up" took four page loads, and each of those pages carried a
   * "Related" panel whose only job was hopping between them.
   *
   * The companion app stays: it is not a setting, it is software somebody
   * downloads, and burying it three tabs deep is how nobody finds it.
   */

  // ---- admin ---------------------------------------------------------------
  {
    href: '/app',
    label: 'Admin console',
    section: 'admin',
    blurb: 'Members, roles and the state of the platform.',
    requires:
      Permission.MEMBER_MANAGE |
      Permission.ROLE_MANAGE |
      Permission.SITE_CONFIG |
      Permission.AUDIT_VIEW,
  },
  {
    href: '/app/members',
    label: 'Members',
    section: 'admin',
    blurb: 'Verify commanders and manage standing.',
    requires: Permission.MEMBER_MANAGE,
  },
  {
    href: '/app/roles',
    label: 'Roles',
    section: 'admin',
    blurb: 'Who holds what, and what each role grants.',
    requires: Permission.ROLE_MANAGE,
  },
  {
    href: '/app/audit',
    label: 'Audit log',
    section: 'admin',
    blurb: 'Every privileged action, and who took it.',
    requires: Permission.AUDIT_VIEW,
  },
];

/** The destinations this mask can reach, in render order. */
export function navFor(mask: PermissionMask): NavItem[] {
  return NAV.filter((item) => item.requires === null || hasAnyPermission(mask, item.requires)).map(
    ({ href, label, section, blurb }) => ({ href, label, section, blurb }),
  );
}

/** Does this member have an admin area to go to at all? */
export function hasAdminArea(mask: PermissionMask): boolean {
  return navFor(mask).some((item) => item.section === 'admin');
}
