/**
 * Everything a member still owes, across every build they are on.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "SrvSurvey will then show cargo items needed only for the primary or all projects."
 *
 * ★ THE QUESTION THIS ANSWERS IS ASKED AT A COMMODITY MARKET ★
 *
 * A per-project list answers "what does this build still want", which is the right question while
 * docked at it. It is the wrong question standing in a market with an empty hold and three builds
 * running: the member wants one list, and they want to know which of it is worth buying HERE.
 *
 * ★ TONNES ARE SUMMED, BUT A HOLD IS NOT ★
 *
 * Two builds wanting 500 t of steel each is 1,000 t to buy and NOT 1,000 t to deliver anywhere: the
 * cargo splits, and the split is the member's decision on arrival. So the per-project figures travel
 * alongside the total rather than being flattened into it — a member who cannot see the breakdown
 * will fill a hold for one site and find half of it unwanted when they land.
 */

/** One build's outstanding line. */
export interface ProjectNeed {
  readonly projectId: string;
  readonly title: string;
  readonly commodity: string;
  /** Tonnes still wanted. Rows at or below zero are the caller's to exclude — see `mergeNeeds`. */
  readonly remaining: number;
  /** Where the market grouping puts it, or null when the source could not say. */
  readonly category?: string | null | undefined;
}

/** Which build wants some of a commodity, and how much. */
export interface NeedClaim {
  readonly projectId: string;
  readonly title: string;
  readonly tonnes: number;
}

export interface MergedNeed {
  readonly commodity: string;
  /** Summed across builds. What to BUY, which is not what to deliver to any one of them. */
  readonly tonnes: number;
  readonly category: string | null;
  /** Biggest share first, so the row leads with where most of it is going. */
  readonly wantedBy: readonly NeedClaim[];
  /**
   * True when more than one build wants it.
   *
   * Worth surfacing on its own: a commodity two builds want is one a member can buy in bulk and
   * split, which is the single most useful thing a combined list can tell somebody at a market.
   */
  readonly shared: boolean;
}

export interface MergedNeeds {
  readonly rows: readonly MergedNeed[];
  /** How many distinct builds contributed. Zero is a real answer and reads differently from one. */
  readonly projects: number;
  readonly totalTonnes: number;
}

/**
 * Folds many builds' outstanding lines into one shopping list.
 *
 * ★ MATCHED CASE-INSENSITIVELY, LABELLED AS FIRST SEEN ★
 *
 * The same commodity arrives spelled differently depending on which source last touched it — the
 * journal, the market dump and the catalogue do not agree on case. Merging on the raw string would
 * put "Steel" and "steel" on two rows, which reads as two commodities and doubles the apparent work.
 */
export function mergeNeeds(needs: readonly ProjectNeed[]): MergedNeeds {
  const byCommodity = new Map<
    string,
    { label: string; category: string | null; claims: Map<string, NeedClaim> }
  >();
  const projects = new Set<string>();

  for (const need of needs) {
    // Finished lines carry no information here: this list exists to be shopped from.
    if (need.remaining <= 0) continue;

    const key = need.commodity.trim().toLowerCase();
    if (key === '') continue;

    projects.add(need.projectId);

    let row = byCommodity.get(key);
    if (row === undefined) {
      row = { label: need.commodity.trim(), category: need.category ?? null, claims: new Map() };
      byCommodity.set(key, row);
    } else if (row.category === null && need.category != null) {
      /*
       * The first source to KNOW the category wins, rather than the first source seen. A depot read
       * off the pad carries no market data at all, so a build filled that way would otherwise pin
       * the row to "no category" for every other build that does know it.
       */
      row.category = need.category;
    }

    const existing = row.claims.get(need.projectId);
    row.claims.set(need.projectId, {
      projectId: need.projectId,
      title: need.title,
      // Summed rather than replaced: one build can report a commodity across several rows.
      tonnes: (existing?.tonnes ?? 0) + need.remaining,
    });
  }

  const rows = [...byCommodity.values()]
    .map((row) => {
      const wantedBy = [...row.claims.values()].sort((a, b) => b.tonnes - a.tonnes);
      return {
        commodity: row.label,
        tonnes: wantedBy.reduce((sum, c) => sum + c.tonnes, 0),
        category: row.category,
        wantedBy,
        shared: wantedBy.length > 1,
      };
    })
    /*
     * Biggest first. A member is filling a hold, so the useful order is the one that fills it — and
     * ties break on name so the list does not reshuffle between two identical polls, which on a
     * strip over a cockpit reads as flicker.
     */
    .sort((a, b) => b.tonnes - a.tonnes || a.commodity.localeCompare(b.commodity));

  return {
    rows,
    projects: projects.size,
    totalTonnes: rows.reduce((sum, r) => sum + r.tonnes, 0),
  };
}
