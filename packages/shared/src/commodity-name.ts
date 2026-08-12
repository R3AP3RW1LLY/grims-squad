/**
 * One commodity, two names.
 *
 * ★ FOUND IN PRODUCTION — SQUADRON OWNER, 2026-08-12 ★
 *
 * "ONE IS COMPLETED AND ONE IS BEING BUILT BUT THEY SHOW NOTHING"
 *
 * Two Refinery Hubs on B 8 b — Gunn Point finished, Rees Prospect under way — both showed as merely
 * planned. Neither project had ever been IDENTIFIED, and an unidentified project cannot be linked
 * to the planned site it fulfils.
 *
 * The fingerprint compares a project's twenty required commodities with the catalogue's. Nineteen
 * matched to the tonne. The twentieth:
 *
 *   the game's journal says   H.E. Suits                    117 t
 *   our catalogue says        Hazardous Environment Suits   117 t
 *
 * `matchBuildType` is exact on every line, and rightly so — two settlement types can differ by a
 * single commodity, and a fuzzy match would confidently mislabel a build and pre-fill the wrong
 * shopping list. But exactness on a name the two sources spell differently is not strictness, it is
 * a false negative that fails silently and takes the whole build with it.
 *
 * ★ NOTHING IS RENAMED ★
 *
 * Both names are correct. The journal's is what the game emits; the catalogue's is what a member
 * reads on a shopping list and searches a market board for. Rewriting either would break the
 * surface that depends on it, so they are simply COMPARED through a key that treats them as one.
 *
 * ★ THE LIST IS SHORT ON PURPOSE ★
 *
 * Measured against production: of every commodity name appearing in a real project's requirements,
 * exactly one did not exist in the catalogue. These are the names the game ABBREVIATES, not a
 * general spelling-correction layer — and the same two that commodity-category.ts already singles
 * out as appearing in zero market rows galaxy-wide.
 */

/**
 * Journal spelling → catalogue spelling, compared case-insensitively.
 *
 * Both sides are listed so the mapping reads as a pair rather than a direction, and so a future
 * source that emits either one lands on the same key.
 */
const SAME_THING: ReadonlyArray<readonly [string, string]> = [
  ['h.e. suits', 'hazardous environment suits'],
  ['agri-medicines', 'agricultural medicines'],
];

const CANONICAL = new Map<string, string>(SAME_THING.map(([alias, real]) => [alias, real]));

/**
 * A key two spellings of one commodity share.
 *
 * Not a display name — never render this. It exists only to decide whether two names refer to the
 * same thing, which is why it lowercases and why an unknown name passes through unchanged rather
 * than being guessed at.
 */
export function commodityKey(name: string): string {
  const flat = name.trim().toLowerCase();
  return CANONICAL.get(flat) ?? flat;
}
