/**
 * Is this station in orbit, or on a rock?
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "the priority is on orbital stations, followed by ground stations."
 *
 * Not an aesthetic preference. A ground station is a descent, a landing, a pad walk and a launch on
 * EVERY run, and across a twenty-run haul that costs far more than the few light years between two
 * candidate stops — which is why `rankBuySources` ranks this above distance inside a band.
 *
 * ★ THE TRAP ★
 *
 * `Outpost` is ORBITAL. `Planetary Outpost` is GROUND. `CraterOutpost` is GROUND. They are the two
 * commonest station types in our own galaxy data — 114,531 rows and 14,848 rows — so a substring
 * match on "Outpost" gets the larger of them exactly backwards, and does it for the most common
 * orbital station in the galaxy.
 *
 * ★ THE LISTS ARE OUR DATA, NOT A WIKI ★
 *
 * Every spelling below was counted in `knowledge_items` before it was written here. Both vocabularies
 * are present and both are load-bearing: the galaxy dump writes display names ("Coriolis Starport"),
 * journals write the game's enum ("Coriolis"), and a station that arrived by the other door would be
 * unrecognised by a list that only knew one of them.
 */

/** In space. Docking is an approach and a pad, and nothing else. */
const ORBITAL = new Set([
  // 114,531 rows. THE trap: no qualifier means orbital.
  'outpost',
  'coriolis starport',
  'coriolis',
  'orbis starport',
  'orbis',
  'ocellus starport',
  'ocellus',
  // Journals from before the rename still say Bernal. Same station, older word.
  'bernal',
  'dodec starport',
  'asteroid base',
  'asteroidbase',
  'mega ship',
  'megaship',
  'space construction depot',
  'spaceconstructiondepot',
]);

/** On a body. Every visit costs a descent and a launch. */
const GROUND = new Set([
  'planetary outpost',
  'planetary port',
  'settlement',
  'onfootsettlement',
  'surfacestation',
  'crateroutpost',
  'craterport',
  'planetary construction depot',
  'planetaryconstructiondepot',
]);

/**
 * True in orbit, false on the ground, null when we cannot say.
 *
 * ★ NULL IS AN ANSWER, AND THE CALLER DEPENDS ON IT ★
 *
 * `rankBuySources` sorts an unknown kind WITH ground, because guessing generously would send a
 * member on a descent they were told they would not make. That pessimism is only safe if it lives
 * in one place — so this function reports ignorance rather than inventing an answer, and never
 * falls back to "probably orbital" for a type Frontier added last Tuesday.
 *
 * A fleet carrier is also null, and deliberately so: it is neither, it moves, and the buy list drops
 * carriers long before this is reached. Answering `true` would quietly readmit them to an ordering
 * built on a distance they do not have.
 */
export function isOrbitalStation(type: string | null | undefined): boolean | null {
  if (type === null || type === undefined) return null;

  // Three sources spell these — EDDN, the galaxy dump, and a member typing one into a box.
  const key = type.trim().toLowerCase();
  if (key === '') return null;

  if (ORBITAL.has(key)) return true;
  if (GROUND.has(key)) return false;
  return null;
}
