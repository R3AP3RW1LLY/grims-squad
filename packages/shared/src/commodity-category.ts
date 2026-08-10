/**
 * Grouping a build's commodities the way the commodity board groups them.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "break down all materials into their respective market categories ... so that its easier to
 * search for these commodities"
 *
 * The point is a member standing at a station with the market open on one screen and the build list
 * on the other. Elite's board is grouped — Metals here, Technology there — and a flat alphabetical
 * list of thirty commodities does not match it, so every line is a fresh hunt.
 *
 * ★ WHY THIS LIVES IN SHARED AND NOT IN EACH SCREEN ★
 *
 * Five surfaces show a build's materials: the website's needs table and shopping list, the
 * companion's needs list and shopping list, and the in-game overlay. Grouping each one where it
 * renders would give five orderings that agree until somebody edits one — and a member reading two
 * of them side by side is exactly who would notice, which is the worst way to find out.
 *
 * So the grouping is decided once, here, and it is a pure function. The category itself comes from
 * the server (see the API's canonical lookup); this module decides only what to do with it.
 */

/**
 * What a commodity nothing sells is filed under.
 *
 * ★ TWO OF THEM ARE REAL AND IT IS WORTH SAYING SO ★
 *
 * Measured across the whole market mirror: `Agricultural Medicines` and `Hazardous Environment
 * Suits` appear in ZERO rows galaxy-wide. Not rare — absent. A member who does not know that will
 * search every board they dock at for something no board has.
 *
 * So they are not hidden and not lumped in with a real category. They get a heading that answers
 * the question before it is asked.
 */
export const UNSOLD_CATEGORY = 'Not sold on any market';

/**
 * Every category the market mirror actually uses.
 *
 * Listed rather than derived so an unexpected value is visible instead of silently becoming its own
 * one-row heading. Fifteen, counted from `commodity_snapshots` on 2026-08-10.
 */
export const MARKET_CATEGORIES: readonly string[] = [
  'Chemicals',
  'Consumer Items',
  'Foods',
  'Industrial Materials',
  'Legal Drugs',
  'Machinery',
  'Medicines',
  'Metals',
  'Minerals',
  'Salvage',
  'Slavery',
  'Technology',
  'Textiles',
  'Waste',
  'Weapons',
];

/** The shape this module needs. Every surface's row type is a superset of it. */
export interface CategorisedRow {
  readonly commodity: string;
  readonly category?: string | null;
  /** What is still wanted. Used for ordering, and to sort finished work to the bottom. */
  readonly remaining: number;
}

export interface CommodityGroup<T extends CategorisedRow> {
  readonly category: string;
  readonly rows: readonly T[];
  /** Summed `remaining` — the heading's own number, so a group can be judged without expanding it. */
  readonly outstanding: number;
  /** True when every row in the group is finished. */
  readonly complete: boolean;
}

/**
 * A build's rows, grouped and ordered.
 *
 * ★ CATEGORIES BY OUTSTANDING TONNAGE, NOT ALPHABETICALLY ★
 *
 * The board is alphabetical and this deliberately is not. A build list is read to decide what to
 * haul next, and the answer is almost always in whichever category holds the most outstanding
 * tonnage — on a typical build that is Metals, which alphabetically sits eighth of fifteen, below
 * the fold on the overlay.
 *
 * Alphabetical would match the board's ORDER; this matches the board's SHAPE, which is what makes a
 * commodity findable, while still putting the work that matters at the top. The headings are the
 * navigation, not the sequence.
 *
 * ★ FINISHED GROUPS SINK ★
 *
 * A category whose every commodity is delivered keeps its place in the list — the delivered rows
 * were restored for a reason yesterday — but sorts below everything outstanding. Its tonnage is
 * zero, so the ordering rule does this on its own; it is written down because it looks like an
 * accident otherwise.
 */
export function groupByCategory<T extends CategorisedRow>(
  rows: readonly T[],
): readonly CommodityGroup<T>[] {
  const buckets = new Map<string, T[]>();

  for (const row of rows) {
    const raw = row.category ?? null;
    const category =
      raw === null || raw === '' || !MARKET_CATEGORIES.includes(raw) ? UNSOLD_CATEGORY : raw;

    const bucket = buckets.get(category);
    if (bucket === undefined) buckets.set(category, [row]);
    else bucket.push(row);
  }

  const groups: CommodityGroup<T>[] = [];
  for (const [category, bucketRows] of buckets) {
    // Within a group: most outstanding first, finished last. Same rule the flat lists used, so
    // grouping changes where a row sits and never why.
    const sorted = [...bucketRows].sort((a, b) => b.remaining - a.remaining);
    const outstanding = sorted.reduce((sum, r) => sum + Math.max(0, r.remaining), 0);

    groups.push({
      category,
      rows: sorted,
      outstanding,
      complete: sorted.every((r) => r.remaining <= 0),
    });
  }

  return groups.sort((a, b) => {
    if (a.outstanding !== b.outstanding) return b.outstanding - a.outstanding;
    /*
     * Two groups with nothing outstanding are both finished, and their order stops being about
     * work. Alphabetical then, because an arbitrary-but-stable order is what stops a completed
     * section reshuffling itself every time the page refreshes.
     */
    return a.category.localeCompare(b.category);
  });
}
