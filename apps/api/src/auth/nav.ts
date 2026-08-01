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
  /*
   * ★ 'ai' ADDED 2026-08-01, ON THE OWNER'S INSTRUCTION ★
   *
   * "a new side bar category called GMSD AI." Deliberately NOT folded into `squadron`: what the
   * assistant knows and how members feed it is its own thing, and burying "Help Train the Bot"
   * among the roster and the ops board is how nobody finds it — which for a collection drive is
   * the same as it not existing.
   */
  readonly section: 'squadron' | 'personal' | 'ai' | 'admin';
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
    href: '/forum',
    label: 'Forum',
    section: 'squadron',
    blurb: 'The boards. Where the squadron talks when it is not in Discord.',
    /*
     * FORUM_VIEW_MEMBER, not null.
     *
     * Squadron owner, 2026-07-29: "all forum users must be in our discord." The
     * nav entry follows the same rule as the content — somebody who cannot see a
     * single category should not be shown a door that opens onto nothing.
     *
     * Per-category `viewPerm` still governs what is behind it, so a future
     * public-readable category is a data change rather than a code one.
     */
    requires: Permission.FORUM_VIEW_MEMBER,
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
    label: 'Commander Mgmt',
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

  // ---- GMSD AI -------------------------------------------------------------
  {
    href: '/gmsd-ai/ask',
    label: 'Ask GMSD AI',
    section: 'ai',
    blurb: 'Prices, systems, ships and our own guides — answered from squadron data.',
    /*
     * ★ AI_CHAT — squadron owner, 2026-08-01 ★
     *
     * "does the Ask GMSD AI page have controls in the permissions page ... so we can show and hide
     * the page when we need too?"
     *
     * It does now. This shipped with `requires: null` on the reasoning that everything the
     * assistant can reach is already visible to any signed-in member, so gating it would refuse
     * through one door what another door gives away.
     *
     * That was an argument about the DATA and the owner's question is about the FEATURE. The model
     * runs on the squadron's own card, alongside post screening and artwork; being able to take it
     * away from a rank — or hold it back while it is being tuned — is an operational control, not a
     * privacy one. `AI_CHAT` already existed for exactly this: "Converse with GMSD AI at all.
     * Without it, the panel is not offered."
     *
     * ★ CHECKED AGAINST THE REAL ROLE TABLE, NOT THE CONSTANT ★
     *
     * `AI_CHAT` is in the MEMBER mask in this file, but what governs access is `roles.perm_mask` in
     * the database, and the two are not the same thing — an earlier draft of this comment claimed
     * SQUADRON_STANDING_PERMISSIONS, which is false: that constant is only the two officer forum
     * bits.
     *
     * Verified: every role that grants ANY permission also grants AI_CHAT. The roles that do not
     * have it hold an empty mask, so those members cannot reach the forum, ops or fleet either —
     * gating this changes nothing for anybody who can currently reach a members' page.
     *
     * Worth re-checking after any role reshuffle. A permission that everybody happens to hold is
     * indistinguishable from one nobody needs, right up until somebody edits a mask.
     */
    requires: Permission.AI_CHAT,
  },
  {
    href: '/gmsd-ai/train',
    label: 'Help Train the Bot',
    section: 'ai',
    blurb: 'Send screenshots that teach GMSD AI to draw Elite.',
    /*
     * Gated on being able to SUBMIT, not on holding AI_TRAINING. A page whose only action is
     * refused is worse than no page — it advertises a feature and then says no.
     */
    requires: Permission.AI_TRAIN_SUBMIT,
  },

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
  /*
   * ★ `/app/members` AND `/app/audit` ARE GONE — squadron owner, 2026-07-29 ★
   *
   * Neither page ever existed. Both were nav entries pointing at routes with no
   * `page.tsx` behind them, so every officer who clicked either one got a 404
   * from their own admin sidebar.
   *
   * The work lives in the console's TABS: members and their promotion standing
   * under `/app?tab=activity`, the log under `/app?tab=audit`. `/app` is
   * already in this list and already requires one of the four admin
   * permissions, so nothing became unreachable by removing these.
   *
   * `/app/roles` stays. It IS a real page — it has its own tabs now, and it is
   * the only surface that can edit a permission mask.
   */
  /*
   * ★ `/app/members` IS BACK, AND THIS TIME THE PAGE EXISTS ★
   *
   * The note above records why it was removed: it was a nav entry pointing at a route with no
   * `page.tsx`, so every officer who clicked it got a 404 from their own sidebar.
   *
   * Squadron owner, 2026-08-01: "we need to create a full on member roster that shows every member
   * in our discord with full administrative tools for them, kick, ban, timeout blah blah blah.
   * create a new Squad Members page in the administration category".
   *
   * `apps/web/src/app/(hub)/app/members/page.tsx` was written in the same change as this line. The
   * lesson from last time is not "never add a nav entry" — it is that the entry and the page ship
   * together or neither does.
   */
  {
    href: '/app/members',
    label: 'Squad members',
    section: 'admin',
    blurb: 'Everybody in the Discord server, and the tools to moderate them.',
    requires: Permission.MEMBER_MANAGE,
  },
  {
    href: '/app/roles',
    label: 'Roles',
    section: 'admin',
    blurb: 'Who holds what, and what each role grants.',
    requires: Permission.ROLE_MANAGE,
  },
  /*
   * ★ ITS OWN PAGE, NOT A TAB — squadron owner, 2026-07-30 ★
   *
   * "include the AI training page in the Administration Category as a new page,
   * show the ingestion categories, if it has been trained, if it is training,
   * and when the next ingestion cycle will be in hours."
   *
   * The admin console's tabs are all about MEMBERS. This is about what the
   * assistant knows and when it last learned it, which is a different question
   * asked by different people — and it is the surface that answers "why did the
   * AI not know that", which otherwise has no answer anybody can look up.
   */
  {
    href: '/app/training',
    label: 'AI training',
    section: 'admin',
    blurb: 'What GMSD AI has learned, what it is learning, and when it next will.',
    requires: Permission.AI_TRAINING,
  },
  {
    href: '/app/conversations',
    label: 'AI conversations',
    section: 'admin',
    blurb: 'What members asked GMSD AI, and what it answered.',
    /*
     * ★ AI_REVIEW, WHICH THE WEBMASTER ALWAYS HAS ★
     *
     * Squadron owner: the log "need[s] to be visible to the webmaster role! this is non-negotiable
     * as the webmaster is the AI developer." That override lives in `effectiveMask`, so using the
     * ordinary permission satisfies it — a separate webmaster check here would be a second answer
     * to a question that already has one, and the two could drift.
     */
    requires: Permission.AI_REVIEW,
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
