/**
 * Ordering bodies the way a system map does.
 *
 * ★ SQUADRON OWNER, 2026-08-07 ★
 *
 * "in the planner in the colonization module, all the sub planets are not appearing alphabetically,
 * and it looks really bad!"
 *
 * ★ WHY THE OBVIOUS FIX IS THE BUG ★
 *
 * Sorting body names as plain strings puts `B 10` before `B 2`, because '1' sorts before '2' one
 * character at a time. That is correct for a dictionary and wrong for anybody reading a system map,
 * where the numbers are numbers.
 *
 * The planner did not sort by name at all — it took whatever order the query returned, which was
 * `distance_ls, body_id`. For a gas giant's moons, all sitting within four light seconds of each
 * other, that is effectively arbitrary: `A 1 c` could appear above `A 1 a` because it was scanned
 * first. Hence "it looks really bad".
 */

/**
 * One body name, split into the runs a human compares.
 *
 * `A 10 b` becomes `['A', 10, 'b']`. Digits become numbers so they compare by value; everything
 * else stays text and compares case-insensitively.
 */
function chunks(name: string): Array<string | number> {
  const out: Array<string | number> = [];
  // Runs of digits, or runs of anything that is not a digit. Whitespace is folded into the text
  // runs and then trimmed, so 'A 1' and 'A  1' order identically.
  const parts = name.match(/\d+|\D+/g) ?? [];

  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      out.push(Number(part));
    } else {
      const text = part.trim().toLowerCase();
      // A run that was pure whitespace carries no ordering information and would otherwise make
      // 'A 1' and 'A1' compare differently.
      if (text !== '') out.push(text);
    }
  }

  return out;
}

/**
 * Compare two body names.
 *
 * A total order: reflexive, and antisymmetric for every pair, which is what `Array.prototype.sort`
 * requires and what stops the tree flickering between renders.
 */
export function compareBodyNames(a: string, b: string): number {
  const left = chunks(a);
  const right = chunks(b);

  const shared = Math.min(left.length, right.length);

  for (let i = 0; i < shared; i += 1) {
    /*
     * Defaulted rather than asserted. The loop bound already guarantees both are present, but
     * `noUncheckedIndexedAccess` cannot see that, and a `!` would be a claim the compiler has to
     * take on trust — an empty string is a real value that orders identically.
     */
    const l = left[i] ?? '';
    const r = right[i] ?? '';
    if (l === r) continue;

    // Both numbers: compare by value, which is the whole point of this function.
    if (typeof l === 'number' && typeof r === 'number') return l - r;

    /*
     * A number against a word. Numbers sort first, so `A 1` comes before `A Belt Cluster 1` — the
     * planets before the debris, which is the order the game's own navigation panel uses.
     */
    if (typeof l === 'number') return -1;
    if (typeof r === 'number') return 1;

    return l < r ? -1 : 1;
  }

  /*
   * One name is a prefix of the other, so the shorter is the parent: `A 1` before `A 1 a`. That is
   * what keeps a moon directly beneath its planet instead of sorting away from it.
   */
  return left.length - right.length;
}

/** Sort body names in place-safe fashion, returning a new array. */
export function sortBodiesByName(names: readonly string[]): string[] {
  return [...names].sort(compareBodyNames);
}

/**
 * Sort anything carrying a body name.
 *
 * Takes the accessor rather than assuming a `name` field, because the planner, the companion and
 * the catalogue each call it something slightly different.
 */
export function sortByBodyName<T>(items: readonly T[], nameOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareBodyNames(nameOf(a), nameOf(b)));
}
