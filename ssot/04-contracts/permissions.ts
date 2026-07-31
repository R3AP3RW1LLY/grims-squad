/**
 * GRIM'S SQUAD HUB — PERMISSION MODEL
 *
 * This file is the SOURCE. `packages/shared/src/permissions.ts` is a byte-identical COPY
 * (ADR-020); CI fails on any difference (ADR-019). To change permissions: edit THIS file,
 * then re-copy. Never edit the copy.
 *
 * WHY A BITMASK (ADR-005):
 *   - A caller's entire authority is one value: cacheable, comparable, and cheap to pass to
 *     the AI gateway so tools can be filtered before the model sees them (INV-011).
 *   - Roles are named BUNDLES of these bits, editable as data in the admin console.
 *   - Effective mask = OR(role masks) AND NOT denyMask. Nothing else grants (INV-001).
 *
 * WHY `bigint` AND `NUMERIC(40,0)`:
 *   SITE_CONFIG is `1n << 63n` = 2^63, which is one greater than the maximum of a signed
 *   64-bit integer. Postgres BIGINT is signed, so it cannot hold the full mask. Storage is
 *   NUMERIC(40,0); transport is a decimal STRING; runtime is `bigint`. No code path may
 *   convert a mask to a JavaScript `number` — it would silently truncate above 2^53 (INV-006).
 *
 * BIT ALLOCATION:
 *   Bits are grouped by domain with reserved gaps, so a new permission never renumbers an
 *   existing one. Renumbering would silently change what every stored role mask means.
 *     0-9   forum        10-19 ops         20-29 fleet & carriers
 *     30-39 BGS          40-49 trade       50-59 AI
 *     60-69 admin        70-79 telemetry   80+   reserved
 */

/** A permission bitmask. Always `bigint`, never `number` (INV-006). */
export type PermissionMask = bigint;

export const Permission = {
  // ── Forum ────────────────────────────────────────────────────────────────
  /** Ring 0. View public categories. The only permission an unauthenticated visitor holds. */
  FORUM_VIEW_PUBLIC: 1n << 0n,
  /** Ring 0.5. Post in public categories. Granted from `applicant` upward. */
  FORUM_POST_PUBLIC: 1n << 1n,
  /** Ring 1. View member-only categories. **The practical definition of "is a member".** */
  FORUM_VIEW_MEMBER: 1n << 2n,
  /** Ring 1. Post in member-only categories. */
  FORUM_POST_MEMBER: 1n << 3n,
  /** Ring 2. View officer categories: Command Deck, Applications, Member Concerns. */
  FORUM_VIEW_OFFICER: 1n << 4n,
  /** Ring 2. Moderate: lock, pin, move, delete, restore, warn, mute, ban. Always audited. */
  FORUM_MODERATE: 1n << 5n,
  /**
   * Ring 2. Post in officer categories and in officer-post-only public categories
   * (Announcements, Squadron Log). Separate from FORUM_MODERATE so a moderator role can exist
   * without announcement rights.
   */
  FORUM_POST_OFFICER: 1n << 6n,
  /**
   * Ring 2. Author the GUIDES board — the site's own documentation.
   *
   * ★ WHY THIS NEEDED ITS OWN BIT ★
   *
   * Squadron owner, 2026-07-29, in two instructions a few hours apart: "only the webmaster
   * can author the joining guide", then — when told SITE_CONFIG also covers the two admiral
   * ranks — "widen to officers too".
   *
   * That wants "officers AND the webmaster", and NEITHER existing bit can express it:
   *
   *   FORUM_POST_OFFICER  officers hold it; the webmaster deliberately does NOT, because
   *                       posting in the squadron's name is squadron standing.
   *   SITE_CONFIG         the webmaster holds it; ordinary officers do not.
   *
   * And a category's `post_perm` is checked with AND semantics — `(mask & required) ===
   * required` — so it cannot mean "either of these". Setting it to one bit locks the other
   * group out, which is exactly the bug that left the site's own documentation editable
   * only by officers while the webmaster maintained it.
   *
   * So this is the bit both groups hold. It is granted to the officer ranks and, being
   * outside SQUADRON_STANDING_PERMISSIONS, is held by the webmaster automatically.
   *
   * ★ NOT SQUADRON STANDING ★
   *
   * Deliberately excluded from SQUADRON_STANDING_PERMISSIONS. A joining guide is website
   * documentation, not the squadron speaking — which is the same distinction that made
   * FORUM_POST_OFFICER the wrong bit for the guides board in the first place.
   */
  FORUM_POST_GUIDE: 1n << 7n,

  // ── Operations ───────────────────────────────────────────────────────────
  /** Ring 1. See the operations board and calendar. */
  OPS_VIEW: 1n << 10n,
  /** Ring 1. Sign up, change state, pick a ship. Trivially reversible, so no AI confirmation. */
  OPS_SIGNUP: 1n << 11n,
  /** Ring 1.5. Create and edit operations. What distinguishes a wing lead from a member. */
  OPS_CREATE: 1n << 12n,
  /** Ring 2. Manage any operation, mark attendance, send squadron-wide Discord messages. */
  OPS_MANAGE: 1n << 13n,

  // ── Fleet & carriers ─────────────────────────────────────────────────────
  /** Ring 1. View squadron fleet and squadron-visible loadouts. Respects per-loadout visibility. */
  FLEET_VIEW: 1n << 20n,
  /** Ring 1. Create and edit **your own** ships and loadouts. Ownership is a row-level predicate. */
  FLEET_EDIT_OWN: 1n << 21n,
  /** Ring 1. View the carrier registry, jump schedule and fuel state. */
  CARRIER_VIEW: 1n << 22n,
  /**
   * Ring 2. Manage carrier records. Owners additionally manage their OWN carriers through a
   * row-level ownership predicate, not through this bit — a carrier owner is not an officer.
   */
  CARRIER_MANAGE: 1n << 23n,
  /** Ring 2. Mark a loadout `isDoctrine` — the officer-approved standard build for a role. */
  FLEET_APPROVE_DOCTRINE: 1n << 24n,

  // ── BGS ──────────────────────────────────────────────────────────────────
  /** Ring 1. View influence charts, the control board and current orders. */
  BGS_VIEW: 1n << 30n,
  /** Ring 1. Submit activity reports, manually or via telemetry ingestion. */
  BGS_REPORT: 1n << 31n,
  /**
   * Ring 2. Set per-system directives (push/hold/suppress/ignore) with written guidance.
   * Steers the whole squadron's evening — AI invocation requires confirmation (INV-014).
   */
  BGS_SET_ORDERS: 1n << 32n,

  // ── Trade ────────────────────────────────────────────────────────────────
  /** Ring 1. Commodity lookup, importer/exporter search, route optimisation, Spansh jobs. */
  TRADE_QUERY: 1n << 40n,
  /** Ring 1. Save routes and post to the squadron trade board. */
  TRADE_SAVE_ROUTE: 1n << 41n,
  /** Ring 1. Create and manage personal price alerts. */
  TRADE_MANAGE_ALERTS: 1n << 42n,

  // ── AI ───────────────────────────────────────────────────────────────────
  /** Ring 1. Converse with GSAI at all. Without it, the panel is not offered. */
  AI_CHAT: 1n << 50n,
  /** Ring 1. GSAI may invoke read tools on this caller's behalf, within the caller's own rights. */
  AI_TOOLS_READ: 1n << 51n,
  /**
   * Ring 1. GSAI may ATTEMPT mutating tools. It does NOT grant the underlying action — the
   * tool's own permission still gates it, and confirmation is still required (INV-014).
   * A member can have GSAI sign them up for an op but not set a BGS order.
   */
  AI_TOOLS_WRITE: 1n << 52n,
  /** Ring 2+. AI administration: kill switches, quota overrides, cross-member conversation review. */
  AI_TOOLS_ADMIN: 1n << 53n,
  /**
   * Ring 2. Read the AI call log, and work the screening queue.
   *
   * ★ NARROWER THAN AI_TOOLS_ADMIN, ON PURPOSE ★
   *
   * Squadron owner, 2026-07-30: every AI conversation is "logged for officer review ... it also
   * need to be visible to the webmaster role! this is non-negotiable as the webmaster is the AI
   * developer."
   *
   * `AI_TOOLS_ADMIN` would satisfy that and also hand every officer the kill switches and quota
   * overrides, which is a great deal more than reading a log. Reviewing what the model said and
   * being able to turn it off are different jobs, and only one of them was asked for.
   *
   * ★ THE WEBMASTER GETS THIS AUTOMATICALLY ★
   *
   * Deliberately NOT in SQUADRON_STANDING_PERMISSIONS, so `ALL_PERMISSIONS & ~SQUADRON_STANDING`
   * includes it. That is the whole mechanism: the webmaster holds everything except the two bits
   * that mean "speaks for the squadron", and debugging a model whose output you cannot see is not
   * speaking for anybody.
   */
  AI_REVIEW: 1n << 54n,
  /**
   * Ring 2. Watch what GMSD AI is learning, and approve what goes into it.
   *
   * ★ WHY THIS IS NOT AI_TOOLS_ADMIN EITHER ★
   *
   * Squadron owner, 2026-07-30: any member may submit screenshots for the image models, and
   * "webmaster + AI_TRAINING holders approve". That is a curation job — looking at a picture and
   * deciding whether it belongs — and it wants to be handed to the members who know Elite, not to
   * whoever also happens to hold the kill switches.
   *
   * It also gates the training page itself: ingestion sources, what has been trained, what is
   * training now, and when the next cycle runs. Reading that is not administering anything.
   *
   * ★ THE WEBMASTER GETS THIS AUTOMATICALLY ★
   *
   * Same mechanism as `AI_REVIEW`: kept out of `SQUADRON_STANDING_PERMISSIONS`, so the webmaster's
   * `ALL_PERMISSIONS & ~SQUADRON_STANDING` includes it. Approving a training image is not speaking
   * for the squadron.
   */
  AI_TRAINING: 1n << 55n,

  // ── Admin ────────────────────────────────────────────────────────────────
  /** Ring 2. Member management: search, filter, notes, probation, activity flags, deactivation. */
  MEMBER_MANAGE: 1n << 60n,
  /**
   * Ring 2+. Create/edit roles and their masks, and edit Discord role mappings.
   * Effectively the ability to grant any other permission — treat as tier 3 (ADR-021).
   */
  ROLE_MANAGE: 1n << 61n,
  /** Ring 2. Read the audit log. Read-only by construction; the log is append-only. */
  AUDIT_VIEW: 1n << 62n,
  /** Ring 2+. Site configuration, integration keys, feature flags, the AI kill switches. */
  SITE_CONFIG: 1n << 63n,

  // ── Telemetry ────────────────────────────────────────────────────────────
  /**
   * Ring 1. Hold device tokens and submit telemetry. Gates the CAPABILITY only — per-category
   * consent in PrivacySetting is a separate, server-enforced control (INV-013).
   */
  TELEMETRY_WRITE: 1n << 70n,
} as const;

export type PermissionName = keyof typeof Permission;

/** Every permission name, in bit order. Used by `describePermissions` and the admin UI. */
export const PERMISSION_NAMES = Object.keys(Permission) as PermissionName[];

/**
 * Permissions that oblige a member to secure their account with a second factor.
 *
 * ★ WHAT MAKES A PERMISSION BELONG HERE ★
 *
 * Not "is it an admin permission" — that is vague and drifts. The test is: CAN
 * HOLDING THIS AFFECT SOMEBODY OTHER THAN YOURSELF, OR THE SITE ITSELF? If yes,
 * a stolen Discord account for this member is a problem for other people, and
 * one factor is not enough.
 *
 * By that test FORUM_MODERATE belongs (it removes other people's words) and
 * FLEET_EDIT_OWN does not (it is your own ship). BGS_SET_ORDERS belongs: it
 * directs the whole squadron's effort for a week.
 *
 * Deliberately a UNION rather than "anything above bit 60". Bit position is an
 * allocation detail — TELEMETRY_WRITE sits at 70 and is not privileged at all —
 * and a rule based on it would silently capture whatever gets allocated next.
 */
export const PRIVILEGED_PERMISSIONS: PermissionMask =
  Permission.MEMBER_MANAGE |
  Permission.ROLE_MANAGE |
  Permission.AUDIT_VIEW |
  Permission.SITE_CONFIG |
  Permission.AI_TOOLS_ADMIN |
  Permission.FORUM_MODERATE |
  Permission.OPS_MANAGE |
  Permission.BGS_SET_ORDERS |
  Permission.FLEET_APPROVE_DOCTRINE;

/**
 * Does this member have to enrol a second factor?
 *
 * Answered from the EFFECTIVE mask, so a member who loses a privileged role
 * stops being obliged, and one who gains it starts — without anybody running a
 * migration or remembering to re-check. That is what makes "when a member is
 * promoted to an admin rank" work with no promotion-time hook at all.
 */
export function requiresTwoFactor(effectiveMask: PermissionMask): boolean {
  return (effectiveMask & PRIVILEGED_PERMISSIONS) !== 0n;
}

/** No permissions. The unauthenticated baseline before FORUM_VIEW_PUBLIC is applied. */
export const NO_PERMISSIONS: PermissionMask = 0n;

/** Every permission. For tests and the bootstrap sysadmin only — never a role preset shortcut. */
export const ALL_PERMISSIONS: PermissionMask = PERMISSION_NAMES.reduce<PermissionMask>(
  (mask, name) => mask | Permission[name],
  0n,
);

/**
 * Permissions that belong to SQUADRON STANDING, not to running the website.
 *
 * ★ THE DISTINCTION THE WEBMASTER ROLE WAS MISSING ★
 *
 * Squadron owner, 2026-07-29, in two instructions:
 *
 *   "webmaster should not be able to post to Announcements, as this is for
 *    officers! ... they do need all website functions but not posting to the web
 *    app announcements."
 *
 *   "officers category should only be visible to officers ... allow the webmaster
 *    to see this in development env only please!"
 *
 * The webmaster held `ALL_PERMISSIONS`, so whoever ran the website could both post
 * in the squadron's name and read the officers' board. The codebase already drew
 * this line elsewhere — `isOfficer` is a RANK question, and its comment notes the
 * webmaster "holds every permission on the platform and no standing in the
 * squadron at all". The mask had simply never been made to agree.
 *
 *   FORUM_POST_OFFICER  Announcements and the Squadron Log — the squadron's voice.
 *   FORUM_VIEW_OFFICER  the officers' board — the squadron's private room.
 *
 * ★ HOW "DEV ONLY" IS ACHIEVED WITHOUT AN ENV BRANCH ★
 *
 * There is deliberately NO `if (NODE_ENV === 'development')` anywhere in the
 * permission path. An environment branch inside an authorisation decision means
 * production runs a code path development never exercises, which is the worst
 * possible place for that to be true.
 *
 * Instead the mask is the same everywhere and DEV SIMPLY HAS AN EXTRA GRANT:
 * `pnpm --filter @grims/db dev:grant-officer-view` adds it as data on a
 * developer's machine. Production is correct by default rather than by remembering
 * to set something, and the difference between environments is visible in the
 * database rather than hidden in a conditional.
 *
 * ★ WHAT IS DELIBERATELY NOT HERE ★
 *
 * BGS_SET_ORDERS, OPS_CREATE, OPS_MANAGE, FLEET_APPROVE_DOCTRINE. Arguably
 * squadron authority too, and excluded because the same instruction says the
 * webmaster needs every website function. Widening this should be a decision
 * somebody makes rather than something inferred.
 */
export const SQUADRON_STANDING_PERMISSIONS: PermissionMask =
  Permission.FORUM_POST_OFFICER | Permission.FORUM_VIEW_OFFICER;

/**
 * Retained under the old name so nothing that imported it breaks silently.
 *
 * @deprecated Use `SQUADRON_STANDING_PERMISSIONS`. The set grew beyond "voice"
 * when the officers' board became webmaster-invisible, and a name that no longer
 * describes its contents is worse than a rename.
 */
export const SQUADRON_VOICE_PERMISSIONS: PermissionMask = SQUADRON_STANDING_PERMISSIONS;

export const WEBMASTER_PERMISSIONS: PermissionMask = ALL_PERMISSIONS & ~SQUADRON_STANDING_PERMISSIONS;

// ─────────────────────────────────────────────────────────────────────────────
// ROLE PRESETS
//
// The seed imports these; it never retypes a mask (see 03-data/seed-plan.md). Roles remain
// editable data at runtime — these are the starting bundles, not a hard-coded authority.
// Mirrors the table in 02-domain/rings-and-roles.md; if the two disagree, THIS file wins.
// ─────────────────────────────────────────────────────────────────────────────

const P = Permission;

/** Unauthenticated. Never persisted as a role row — this is the default mask for no session. */
const GUEST: PermissionMask = P.FORUM_VIEW_PUBLIC;

/** Application in flight. Public forum plus their own application thread (by ownership predicate). */
const APPLICANT: PermissionMask = GUEST | P.FORUM_POST_PUBLIC;

/** The main body of the squadron. Everything the squadron does day to day. */
const MEMBER: PermissionMask =
  APPLICANT |
  P.FORUM_VIEW_MEMBER |
  P.FORUM_POST_MEMBER |
  P.OPS_VIEW |
  P.OPS_SIGNUP |
  P.FLEET_VIEW |
  P.FLEET_EDIT_OWN |
  P.CARRIER_VIEW |
  P.BGS_VIEW |
  P.BGS_REPORT |
  P.TRADE_QUERY |
  P.TRADE_SAVE_ROUTE |
  P.TRADE_MANAGE_ALERTS |
  P.AI_CHAT |
  P.AI_TOOLS_READ |
  P.AI_TOOLS_WRITE |
  P.TELEMETRY_WRITE;

/** Member plus the ability to create and run operations. */
const WING_LEAD: PermissionMask = MEMBER | P.OPS_CREATE;

/** Moderation, member management, BGS direction, audit visibility. */
const OFFICER: PermissionMask =
  WING_LEAD |
  P.FORUM_VIEW_OFFICER |
  P.FORUM_POST_OFFICER |
  /*
   * Authoring the guides board. Owner, 2026-07-29: "widen to officers too" — after first
   * saying only the webmaster should author the joining guide, and being told SITE_CONFIG
   * would also cover the two admiral ranks.
   *
   * A separate bit from FORUM_POST_OFFICER because the WEBMASTER needs this one too, and
   * deliberately does not have that one. See the note on FORUM_POST_GUIDE.
   */
  P.FORUM_POST_GUIDE |
  P.FORUM_MODERATE |
  /*
   * Reading the AI log and working the screening queue. Officers are who the owner named as the
   * reviewers, and a queue nobody can open is a queue that fills up.
   */
  P.AI_REVIEW |
  /*
   * Watching what the AI is learning, and approving the screenshots members submit for it.
   * Officers get it for the same reason they get AI_REVIEW: a queue nobody can open fills up,
   * and judging whether a picture of a Krait belongs in a training set is a job for people who
   * fly them.
   */
  P.AI_TRAINING |
  P.OPS_MANAGE |
  P.CARRIER_MANAGE |
  P.FLEET_APPROVE_DOCTRINE |
  P.BGS_SET_ORDERS |
  P.MEMBER_MANAGE |
  P.AUDIT_VIEW;

/** Officer plus role management — the ability to grant any other permission. */
const COMMANDER: PermissionMask = OFFICER | P.ROLE_MANAGE;

/** Site configuration, integration keys, AI administration. */
const SYSADMIN: PermissionMask = COMMANDER | P.SITE_CONFIG | P.AI_TOOLS_ADMIN;

// ── Orthogonal tags — non-hierarchical, confer no rank ───────────────────────

/** Grants BGS reporting and posting rights in BGS Intelligence. Drives tick-digest routing. */
const TAG_BGS_TEAM: PermissionMask = P.BGS_REPORT;
/** Owners manage their OWN carriers by row-level predicate; this tag drives notification routing. */
const TAG_CARRIER_OWNER: PermissionMask = P.CARRIER_VIEW;
/** Matchmaking and notification routing only. Grants nothing. */
const TAG_MINER: PermissionMask = NO_PERMISSIONS;
/** Matchmaking and notification routing only. Grants nothing. */
const TAG_COMBAT_WING: PermissionMask = NO_PERMISSIONS;
/** Matchmaking and notification routing only. Grants nothing. */
const TAG_EXPLORER: PermissionMask = NO_PERMISSIONS;

export const ROLE_PRESETS = {
  guest: GUEST,
  applicant: APPLICANT,
  member: MEMBER,
  wing_lead: WING_LEAD,
  officer: OFFICER,
  commander: COMMANDER,
  sysadmin: SYSADMIN,
  bgs_team: TAG_BGS_TEAM,
  carrier_owner: TAG_CARRIER_OWNER,
  miner: TAG_MINER,
  combat_wing: TAG_COMBAT_WING,
  explorer: TAG_EXPLORER,
} as const satisfies Record<string, PermissionMask>;

export type RoleKey = keyof typeof ROLE_PRESETS;

/** Role keys that imply rank. The rest are orthogonal tags (`Role.isHierarchical = false`). */
export const HIERARCHICAL_ROLES: readonly RoleKey[] = [
  'guest',
  'applicant',
  'member',
  'wing_lead',
  'officer',
  'commander',
  'sysadmin',
] as const;

/** Display order and precedence only. Rank confers nothing — permissions do. */
export const ROLE_RANK_ORDER: Record<RoleKey, number> = {
  guest: 0,
  applicant: 10,
  member: 20,
  wing_lead: 30,
  officer: 40,
  commander: 50,
  sysadmin: 60,
  bgs_team: 100,
  carrier_owner: 100,
  miner: 100,
  combat_wing: 100,
  explorer: 100,
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Does `mask` hold every bit in `required`?
 *
 * Multi-bit `required` is treated as AND, deliberately: an endpoint declaring
 * `FORUM_VIEW_OFFICER | FORUM_MODERATE` needs both. For OR semantics call this twice —
 * an implicit OR would make a compound requirement silently weaker than it reads.
 */
export function hasPermission(mask: PermissionMask, required: PermissionMask): boolean {
  return (mask & required) === required;
}

/** Does `mask` hold at least one bit in `anyOf`? Explicit, so OR is never accidental. */
export function hasAnyPermission(mask: PermissionMask, anyOf: PermissionMask): boolean {
  return (mask & anyOf) !== 0n;
}

/**
 * Account states. Only `active` may hold permissions.
 * Mirrors `UserStatus` in the Prisma schema; kept here so the mask computation cannot be
 * called without one.
 */
export type AccountStatus = 'active' | 'inactive' | 'banned' | 'left';

/**
 * The authoritative effective-mask computation (INV-001).
 * OR of all granted role masks, AND NOT the user's deny mask. Deny always wins (INV-007).
 * This is the ONLY function that may produce an effective mask.
 *
 * ★ `status` IS REQUIRED, AND THAT IS A SECURITY FIX. ★
 * This function previously took only roles and a deny mask. Because `manual` role grants
 * deliberately survive the nightly Discord reconciliation, and because `guildMemberRemove`
 * was not a cache-bust trigger, a departed or banned officer's mask was recomputed identically
 * forever — retaining FORUM_VIEW_OFFICER, AUDIT_VIEW, MEMBER_MANAGE and BGS_SET_ORDERS with no
 * revocation path short of a human hand-editing `denyMask` (RED-TEAM R4).
 *
 * Any status other than `active` collapses to NO_PERMISSIONS. A banned user is not a user with
 * fewer permissions; they are a user with none.
 */
export function computeEffectiveMask(
  roleMasks: readonly PermissionMask[],
  denyMask: PermissionMask = 0n,
  status: AccountStatus = 'active',
): PermissionMask {
  if (status !== 'active') return NO_PERMISSIONS;
  const granted = roleMasks.reduce<PermissionMask>((acc, m) => acc | m, 0n);
  return granted & ~denyMask;
}

/** Expand a mask to its permission names. Used by the admin UI and every audit row. */
export function describePermissions(mask: PermissionMask): PermissionName[] {
  return PERMISSION_NAMES.filter((name) => (mask & Permission[name]) !== 0n);
}

/** Build a mask from names. Throws on an unknown name rather than silently dropping it. */
export function maskFromNames(names: readonly string[]): PermissionMask {
  return names.reduce<PermissionMask>((mask, name) => {
    const bit = (Permission as Record<string, PermissionMask | undefined>)[name];
    if (bit === undefined) {
      throw new Error(`Unknown permission: ${name}`);
    }
    return mask | bit;
  }, 0n);
}

/**
 * Serialise for transport or storage. **Decimal string, never a number** — a mask above 2^53
 * would silently lose precision as a JSON number (INV-006).
 */
export function maskToString(mask: PermissionMask): string {
  return mask.toString(10);
}

/** Parse a mask from storage or transport. Rejects anything that is not a non-negative integer. */
export function maskFromString(value: string): PermissionMask {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid permission mask: ${value}`);
  }
  return BigInt(value);
}

/** Permissions in `required` that `mask` lacks. Powers actionable "you need X" error messages. */
export function missingPermissions(
  mask: PermissionMask,
  required: PermissionMask,
): PermissionName[] {
  return describePermissions(required & ~mask);
}

/**
 * Which roles would grant `required`? Powers the admin console's "who does this affect?"
 * preview and GSAI's "you need X; an officer can grant it" responses.
 */
export function rolesGranting(required: PermissionMask): RoleKey[] {
  return (Object.keys(ROLE_PRESETS) as RoleKey[]).filter((key) =>
    hasPermission(ROLE_PRESETS[key], required),
  );
}
