/**
 * Founding standing, derived from the roles a member holds.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * A Founders tab on the roster listing four named people; Pebblemerchant titled
 * "Founder" where their card said "Webmaster"; and a fixed order at the top of
 * the roster — Mr Grimsoul first, then the other founders, then Pebblemerchant,
 * then everybody else.
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
 * Role keys that carry founding standing, whatever their rank_order happens to
 * be. Holding one pins a member to the top of the roster and replaces the site
 * titles on their card with the founding one.
 */
export const FOUNDING_ROLE_KEYS: readonly string[] = ['founder', 'co_founder', 'hub_founder'];

/**
 * The subset that makes somebody one of the squadron's founders — the Founders
 * tab, and nothing else.
 *
 * ★ WHY `hub_founder` IS NOT HERE ★
 *
 * The owner named four people for the tab and then said Pebblemerchant comes
 * "after the founders" — which reads them as somebody who sits directly behind
 * that group rather than inside it. They are titled Founder because the same
 * instruction says so, and that title is `roles.name` on their own row, so the
 * two facts do not have to fight each other.
 */
export const SQUADRON_FOUNDING_ROLE_KEYS: readonly string[] = ['founder', 'co_founder'];

/** What one member's founding standing amounts to, once the roles are read. */
export interface FoundingStanding {
  /** The title shown in place of their site roles. `roles.name`, verbatim. */
  readonly title: string;
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
    title: top.name,
    precedence: top.rankOrder,
    foundedSquadron: SQUADRON_FOUNDING_ROLE_KEYS.includes(top.key),
  };
}
