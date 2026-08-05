/**
 * Founding standing, derived from the roles a member holds.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * A Founders tab on the roster listing four named people, and a fixed order at
 * the top of the roster — Mr Grimsoul first, then the other founders, then
 * Pebblemerchant, then everybody else.
 *
 * ★ AND PEBBLEMERCHANT IS NOT A FOUNDER — SQUADRON OWNER, 2026-08-05 ★
 *
 * "pebblemerchant should not have anything to do with founder in their name. i
 * am purely the webmaster! that is it! anything else would be misconstruing
 * this!" An earlier reading of the first request gave them a founding title;
 * that was wrong and is corrected here. They keep the ORDER the owner asked for
 * — directly behind the founders, first on the Members tab — and their card
 * says Webmaster, because that is what they are.
 *
 * So a role can carry position without carrying a claim: the two are separate
 * questions, and only the founders answer yes to the second.
 *
 * ★ NOT A LIST OF NAMES ★
 *
 * The obvious build is five display names in an array. That is wrong the day
 * somebody is renamed, it cannot be corrected without a deploy, and it puts an
 * identity claim in a file nobody reviews for identity claims — the same
 * reasoning that keeps Discord snowflakes out of source (INV-008).
 *
 * So the standing is a ROLE, seeded and granted by
 * `20260805180000_founding_roles`, and everything on this page reads from those
 * rows: the TITLE is `roles.name` and the ORDER is `roles.rank_order`. Renaming
 * "Co-Founder", reordering the pins, or making somebody else a founder is an
 * edit on /app -> Roles from then on.
 *
 * What stays in source is only the set of KEYS that mean "founding" — a key is a
 * stable identifier rather than a name somebody reads or edits, and the codebase
 * already names role keys in source where it must (HIERARCHICAL_ROLES,
 * UNRANKED_ROLE_KEY).
 */

/**
 * Role keys that pin a member to the top of the roster, whatever their
 * rank_order happens to be. Position only — a title is a separate question,
 * answered by TITLED_FOUNDING_ROLE_KEYS below.
 */
export const FOUNDING_ROLE_KEYS: readonly string[] = ['founder', 'co_founder', 'roster_pin'];

/**
 * The keys that also REPLACE the site titles on a member's card.
 *
 * `roster_pin` is deliberately absent: it moves somebody up the list and says
 * nothing about who they are, so the card goes on showing the roles they
 * actually hold.
 */
export const TITLED_FOUNDING_ROLE_KEYS: readonly string[] = ['founder', 'co_founder'];

/**
 * The subset that makes somebody one of the squadron's founders — the Founders
 * tab, and nothing else.
 */
export const SQUADRON_FOUNDING_ROLE_KEYS: readonly string[] = ['founder', 'co_founder'];

/** What one member's founding standing amounts to, once the roles are read. */
export interface FoundingStanding {
  /**
   * The title shown in place of their site roles — `roles.name`, verbatim — or
   * null for a role that only carries position, whose holder keeps the titles
   * they already had.
   */
  readonly title: string | null;
  /**
   * Where they sit at the top of the roster. LOWER IS MORE SENIOR — the same
   * direction as the leadership ladder, where Galactic Admiral is 10.
   *
   * `roles.rank_order`, so the owner reorders the pins by editing the role
   * rather than by asking for a deploy.
   */
  readonly precedence: number;
  /** One of the squadron's founders, and therefore on the Founders tab. */
  readonly foundedSquadron: boolean;
}

/**
 * The founding standing in a set of held roles, or null.
 *
 * Takes the MOST SENIOR when somebody holds more than one — which nothing grants
 * today, and which a hand-edit on the roles page could produce tomorrow. Picking
 * the first match instead would make the answer depend on query order, so a
 * member's title could change between two page loads with nothing in the
 * database having moved.
 */
export function foundingStanding(
  roles: ReadonlyArray<{ key: string; name: string; rankOrder: number }>,
): FoundingStanding | null {
  const founding = roles
    .filter((r) => FOUNDING_ROLE_KEYS.includes(r.key))
    .sort((a, b) => a.rankOrder - b.rankOrder);

  const top = founding[0];
  if (top === undefined) return null;

  return {
    title: TITLED_FOUNDING_ROLE_KEYS.includes(top.key) ? top.name : null,
    precedence: top.rankOrder,
    foundedSquadron: SQUADRON_FOUNDING_ROLE_KEYS.includes(top.key),
  };
}
