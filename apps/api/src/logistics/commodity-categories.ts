import type { PrismaClient } from '@grims/db';

/**
 * What category the market files a commodity under.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "break down all materials into their respective market categories ... so that its easier to search
 * for these commodities"
 *
 * Five surfaces render a build's materials — the website's needs table and shopping list, the
 * companion's two, and the in-game overlay. All five group with the same pure function in
 * @grims/shared, and all five get the category from HERE, so a commodity cannot be filed under
 * Metals on one screen and Technology on another.
 *
 * ★ WHY commodity_snapshots AND NOT market_entries ★
 *
 * Both hold a category. `market_entries` is nineteen million rows and answering "what category is
 * each commodity" from it means a DISTINCT ON over the largest table in the database — the same scan
 * the collector's name lookup was careful to avoid.
 *
 * `commodity_snapshots` is the hourly rollup: 393 distinct commodities, one row per commodity per
 * hour, and it carries `category` for exactly this kind of question. It is also the source the
 * carrier-cargo normaliser already uses, so the two agree by construction.
 *
 * ★ CACHED, BECAUSE IT CHANGES ABOUT NEVER ★
 *
 * A commodity's category is set by Frontier and has not moved in the life of this platform. The
 * cache is an hour and the read is 393 rows, so the cost of being wrong for an hour is nil and the
 * cost of not caching is a lookup on every project page load.
 */

let cached: { at: number; byCommodity: Map<string, string> } | null = null;

const TTL_MS = 60 * 60_000;

export async function commodityCategories(db: PrismaClient): Promise<Map<string, string>> {
  if (cached !== null && Date.now() - cached.at < TTL_MS) return cached.byCommodity;

  /*
   * ★ A CATEGORY IS DECORATION; A SHOPPING LIST IS NOT ★
   *
   * This is a heading on a table. The rows underneath it are somebody deciding what to fly and buy,
   * and they must arrive whether or not the lookup did. So a failure here returns an empty map — the
   * surfaces group everything as uncategorised, which is the shape they had before this existed.
   *
   * REPORTED, not swallowed. A `.catch(() => [])` on a route query once hid SQLSTATE 53100 failures
   * so well that the timings looked BETTER while results silently dropped from fifteen to zero. The
   * lesson taken from that is not "never fail soft" — it is "never fail quiet".
   */
  let rows: Array<{ commodity: string; category: string | null }>;
  try {
    rows = await db.$queryRawUnsafe<Array<{ commodity: string; category: string | null }>>(
      `SELECT DISTINCT ON (commodity) commodity, category
         FROM commodity_snapshots
        WHERE category IS NOT NULL
        ORDER BY commodity, observed_at DESC`,
    );
  } catch (err: unknown) {
    console.warn(
      '[categories] could not read commodity categories — lists will render ungrouped:',
      err instanceof Error ? err.message : String(err),
    );
    return new Map();
  }

  const byCommodity = new Map(rows.map((r) => [r.commodity, r.category ?? '']));

  /*
   * Only cached once it holds something. An empty answer on a fresh database — or during the hour
   * before the first rollup runs — would otherwise be held for an hour, and every commodity would
   * be filed under "Not sold on any market" with nothing to say why.
   */
  if (byCommodity.size > 0) cached = { at: Date.now(), byCommodity };
  return byCommodity;
}

/**
 * Attaches the category to whatever rows are being sent out.
 *
 * Returns a NEW array; the callers hand these straight to a response, and mutating a service's own
 * cached rows to decorate a payload is how one caller's presentation leaks into another's data.
 */
export function withCategories<T extends { commodity: string }>(
  rows: readonly T[],
  categories: ReadonlyMap<string, string>,
): Array<T & { category: string | null }> {
  return rows.map((row) => ({ ...row, category: categories.get(row.commodity) ?? null }));
}
