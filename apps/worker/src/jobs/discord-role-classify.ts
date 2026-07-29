/**
 * Deciding what each Discord role MEANS to us.
 *
 * ★ WHY RULES, AND WHY ONLY AS A SEED ★
 *
 * Discord has no concept of a role's purpose — rank, award, membership and
 * "opens the mining channel" are all just roles in one flat list. Something has
 * to draw the distinction, and the choices are: ask an officer to classify
 * forty roles by hand, or infer it and let them correct what we got wrong.
 *
 * These rules infer it. They run on roles that are still UNCLASSIFIED and never
 * overwrite a category already set, so a correction made in the database is
 * permanent and the next sync will not undo it. That is the whole design: the
 * rules are a starting point, the data is the truth.
 *
 * ★ THE ONE RULE THAT IS NOT A GUESS ★
 *
 * A role mapped to a hierarchical internal role IS a rank. That comes from the
 * mapping an officer already made, not from its name, so renaming "Cadet" to
 * anything else keeps it a rank.
 */

export type RoleCategory = 'rank' | 'membership' | 'award' | 'hidden' | 'other';

export interface ClassifiableRole {
  readonly id: string;
  readonly name: string;
  /** True when this role maps to an internal role that confers a rank. */
  readonly mapsToRank: boolean;
  readonly category: RoleCategory;
}

/**
 * Roles that exist to open a channel.
 *
 * Named by the squadron owner. These are the ones a card must NOT show: eight
 * lines of channel access buries the three lines somebody actually reads.
 *
 * Matched case-insensitively and ignoring surrounding punctuation, because
 * "Anti-Xeno" and "Anti Xeno" are the same decision.
 */
const CHANNEL_ACCESS = [
  'combat pilots',
  'anti-xeno',
  'haulers',
  'miners',
  'explorers',
  'exo biologists',
  'colonizers',
  'bgs',
];

/** Standing in the squadron itself. */
const MEMBERSHIP = ['grims squad members', 'allies', 'ally', 'allys'];

/**
 * Normalises a role name for comparison.
 *
 * Strips the typographic apostrophe as well as the straight one: the guild's
 * own role is "Grim’s Squad members" with U+2019, and a list written with a
 * plain quote would silently never match it.
 */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function classifyRole(role: ClassifiableRole): RoleCategory {
  // Already decided by a person. Never second-guessed.
  if (role.category !== 'other') return role.category;

  // Not a guess: an officer mapped this role to a rank.
  if (role.mapsToRank) return 'rank';

  const name = normalise(role.name);

  // The squadron's award scheme is prefixed, so this catches LEGEND and every
  // Loyalty tier without listing them — and catches the next one automatically.
  if (name.startsWith('gmsd')) return 'award';

  if (MEMBERSHIP.includes(name)) return 'membership';
  if (CHANNEL_ACCESS.includes(name)) return 'hidden';

  /*
   * Everything else stays `other`, and `other` is not rendered.
   *
   * Deliberately not defaulting to visible: bots, boosters and staff roles all
   * live in the same list, and a card that showed everything unrecognised would
   * put "YAGPDB.xyz" on somebody's profile. Showing nothing is the recoverable
   * mistake; an officer can promote a role to a category when they want it.
   */
  return 'other';
}

export interface ClassifyStore {
  /** Roles with their current category and whether they map to a rank. */
  listForClassification(): Promise<ClassifiableRole[]>;
  setCategory(roleId: string, category: RoleCategory): Promise<void>;
}

export interface ClassifyReport {
  readonly classified: number;
  readonly byCategory: Record<string, number>;
}

/** Classifies every role that nobody has classified yet. */
export async function classifyGuildRoles(store: ClassifyStore): Promise<ClassifyReport> {
  const roles = await store.listForClassification();
  const byCategory: Record<string, number> = {};
  let classified = 0;

  for (const role of roles) {
    const category = classifyRole(role);
    if (category === role.category) continue;

    await store.setCategory(role.id, category).catch(() => undefined);
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    classified += 1;
  }

  return { classified, byCategory };
}
