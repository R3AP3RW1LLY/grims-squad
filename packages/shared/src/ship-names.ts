/**
 * Turning Elite's internal names into something a person can read.
 *
 * ★ THREE REAL BUGS THIS EXISTS TO FIX ★
 *
 * 1. `$TacticalSuit_Class1_Name;` appeared in the squadron's ships chart in production. It is not
 *    a ship, it is a Dominator suit — and the token is Frontier's own localisation failing.
 * 2. A member's "current ship" was blank or wrong, because it was read from `LoadGame`, which
 *    fires once at login and reports a SUIT when you logged out on foot.
 * 3. `Loadout` — the event that actually tracks what you are flying — carries the ship in
 *    LOWERCASE with no `Ship_Localised` at all, so anything relying on Frontier's localisation
 *    gets nothing from the one event that is always current.
 *
 * ★ WHY WE RESOLVE NAMES OURSELVES ★
 *
 * Frontier's `Ship_Localised` is unreliable in two directions. It is ABSENT on `Loadout` and on
 * ships whose internal name already reads as English (`Python`, `Anaconda`), and it is WRONG for
 * upgraded suits: production shows `UtilitySuit_Class4` and `UtilitySuit_Class5` both localising
 * to `$UtilitySuit_Class1_Name;`, because Frontier only registered the grade-1 string.
 *
 * The raw internal name is always present and always unambiguous. So it is the source of truth
 * here, and `Ship_Localised` is used only as a fallback for a ship we have not mapped — never the
 * other way round.
 */

/** Internal name (lowercased) → what a commander calls it. */
const SHIPS: Readonly<Record<string, string>> = {
  adder: 'Adder',
  anaconda: 'Anaconda',
  asp: 'Asp Explorer',
  asp_scout: 'Asp Scout',
  belugaliner: 'Beluga Liner',
  cobramkiii: 'Cobra Mk III',
  cobramkiv: 'Cobra Mk IV',
  cobramkv: 'Cobra Mk V',
  corsair: 'Corsair',
  cutter: 'Imperial Cutter',
  diamondback: 'Diamondback Scout',
  diamondbackxl: 'Diamondback Explorer',
  dolphin: 'Dolphin',
  eagle: 'Eagle',
  empire_courier: 'Imperial Courier',
  empire_eagle: 'Imperial Eagle',
  empire_trader: 'Imperial Clipper',
  federation_corvette: 'Federal Corvette',
  federation_dropship: 'Federal Dropship',
  federation_dropship_mkii: 'Federal Assault Ship',
  federation_gunship: 'Federal Gunship',
  ferdelance: 'Fer-de-Lance',
  hauler: 'Hauler',
  independant_trader: 'Keelback',
  independent_trader: 'Keelback',
  krait_light: 'Krait Phantom',
  krait_mkii: 'Krait Mk II',
  mamba: 'Mamba',
  mandalay: 'Mandalay',
  orca: 'Orca',
  python: 'Python',
  sidewinder: 'Sidewinder',
  type6: 'Type-6 Transporter',
  type7: 'Type-7 Transporter',
  type8: 'Type-8 Transporter',
  type9: 'Type-9 Heavy',
  type9_military: 'Type-10 Defender',
  typex: 'Alliance Chieftain',
  typex_2: 'Alliance Crusader',
  typex_3: 'Alliance Challenger',
  viper: 'Viper Mk III',
  viper_mkiv: 'Viper Mk IV',
  vulture: 'Vulture',

  /*
   * The newer hulls, seeded from what production actually reported rather than from memory —
   * these are the ones a guess would most likely get wrong.
   */
  explorer_nx: 'Caspian Explorer',
  lakonminer: 'Type-11 Prospector',
  panthermkii: 'Panther Clipper Mk II',
  python_nx: 'Python Mk II',
};

/**
 * Suit families.
 *
 * Frontier's internal names do not match what anybody calls them: Tactical is the Dominator,
 * Utility is the Maverick, Exploration is the Artemis. Mapping them here means a member reads the
 * name from the game rather than the name from the codebase.
 */
const SUITS: Readonly<Record<string, string>> = {
  flightsuit: 'Flight Suit',
  tacticalsuit: 'Dominator Suit',
  utilitysuit: 'Maverick Suit',
  explorationsuit: 'Artemis Suit',
};

/** Anything of the form `$Something_Name;` — Frontier's unresolved localisation token. */
export const LOCALISATION_TOKEN = /^\$.*;$/;

/**
 * Whether an internal name is a SUIT rather than a ship.
 *
 * Checked on the RAW name, never the localised one — the localised name is exactly what is broken
 * for upgraded suits, so filtering on it would let `$TacticalSuit_Class1_Name;` through.
 */
export function isSuit(raw: string): boolean {
  const key = raw.toLowerCase();
  return key === 'flightsuit' || /suit_class\d+$/.test(key) || key.endsWith('suit');
}

/**
 * A suit's name and grade, e.g. `TacticalSuit_Class2` → "Dominator Suit, Grade 2".
 *
 * The grade comes from the internal name because that is the only place it is reliable — the
 * localised string collapses every grade onto the grade-1 token.
 */
export function suitName(raw: string): string | null {
  const key = raw.toLowerCase();
  if (key === 'flightsuit') return SUITS['flightsuit'] ?? null;

  const match = /^(\w+?suit)_class(\d+)$/.exec(key);
  if (match === null) return null;

  const family = SUITS[match[1] ?? ''];
  if (family === undefined) return null;

  const grade = Number(match[2]);
  // Grade 1 is the base suit; saying "Grade 1" everywhere would be noise on the common case.
  return grade > 1 ? `${family}, Grade ${grade}` : family;
}

/**
 * A display name for whatever the journal reported.
 *
 * ★ RAW FIRST, LOCALISED ONLY AS A FALLBACK, TOKEN NEVER ★
 *
 * Returns null when it is a suit and suits are not wanted, so a caller filtering a ships chart
 * gets a clean absence rather than having to know what a suit looks like.
 *
 * The final guard is the important one: anything still matching `$…;` is refused outright. That is
 * what stops the next unmapped hull or suit grade from putting a raw token on a page, which is how
 * this was noticed in the first place.
 */
export function shipDisplayName(
  raw: string | null | undefined,
  localised?: string | null,
  opts: { allowSuits?: boolean } = {},
): string | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (isSuit(raw)) {
    if (opts.allowSuits !== true) return null;
    return suitName(raw);
  }

  const mapped = SHIPS[raw.toLowerCase()];
  if (mapped !== undefined) return mapped;

  /*
   * An unmapped hull. Frontier's localised name is better than the internal one — but only if it
   * is a real name rather than an unresolved token.
   */
  if (typeof localised === 'string' && localised !== '' && !LOCALISATION_TOKEN.test(localised)) {
    return localised;
  }

  // Nothing usable. Null rather than a token or a snake_case identifier on somebody's profile.
  return null;
}
