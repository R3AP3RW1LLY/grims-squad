/**
 * Where one system's exports and imports come from — the mirror, the plan, or nowhere.
 *
 * ★ SQUADRON OWNER, 2026-08-25 ★
 *
 * Asked whether the nexus should use real market data or the economy model, the answer was: "real
 * where we have it, predicted elsewhere, and say which is which."
 *
 * `nexusTrade` already carries that distinction per system. This is the rule that DECIDES it, kept
 * separate from both the database and `predictMarket` so it can be tested without either.
 *
 * ★ WHY THIS IS NOT A DETAIL ★
 *
 * Checked against production the day it was written: of nine planned systems, three had real
 * markets and six had none. The mixed case is not an edge case — it is the ordinary state of a
 * squadron that is part-way through building, and it is what the whole basis field exists for.
 */

import type { NexusBasis, NexusSystem } from './colony-nexus.js';

/**
 * One commodity at one real station, as the market mirror holds it.
 *
 * `supply` and `demand` are the station's side of the trade: stock it holds for sale, and tonnage
 * it wants to buy. From the SYSTEM's point of view those invert into exports and imports, which is
 * the one translation this module exists to get right.
 */
export interface MeasuredRow {
  readonly commodity: string;
  /** Tonnes the station has on offer. Above zero means the system can EXPORT it. */
  readonly supply: number;
  /** Tonnes the station wants. Above zero means the system IMPORTS it. */
  readonly demand: number;
}

/** What the economy model expects a planned station to trade, once it is standing. */
export interface PredictedLists {
  readonly exports: readonly string[];
  readonly imports: readonly string[];
}

/**
 * Decides one system's basis and its two lists.
 *
 * ★ MEASURED WINS, AND THE PREDICTION IS NOT MIXED IN ★
 *
 * A system part-way through construction has both: two finished stations selling into the mirror,
 * three still being hauled to. The tempting move is to merge them — real rows plus the model's
 * guess for the rest — and it would be wrong.
 *
 * Merging produces one list under one badge where some entries can be flown tonight and some
 * cannot. That is precisely the confusion `flyableNow` was added to prevent, and it would be worse
 * here than on the route, because it would be invisible: nothing in a merged list says which half
 * is which.
 *
 * So `measured` means "what is really tradeable here now". The unbuilt stations in the same system
 * are deliberately absent, and the system's own plan page is where a member reads about those.
 */
export function systemMarket(input: {
  readonly systemName: string;
  readonly measured: readonly MeasuredRow[];
  readonly predicted: readonly PredictedLists[];
}): NexusSystem {
  const exports = new Set<string>();
  const imports = new Set<string>();

  for (const row of input.measured) {
    const name = row.commodity.trim();
    if (name === '') continue;
    // A station can both stock and want the same commodity. Both are true, and both are recorded.
    if (row.supply > 0) exports.add(name);
    if (row.demand > 0) imports.add(name);
  }

  /*
   * Rows can exist and still say nothing tradeable — a station whose stock and demand are both
   * zero for everything is in the mirror but is not a market yet. Treating that as `measured`
   * would report a standing station that trades nothing, which reads as a bug rather than as the
   * empty market it is, so it falls through to the plan.
   */
  if (exports.size > 0 || imports.size > 0) {
    return {
      systemName: input.systemName,
      exports: [...exports].sort(),
      imports: [...imports].sort(),
      basis: 'measured' satisfies NexusBasis,
    };
  }

  for (const site of input.predicted) {
    for (const commodity of site.exports) {
      const name = commodity.trim();
      if (name !== '') exports.add(name);
    }
    for (const commodity of site.imports) {
      const name = commodity.trim();
      if (name !== '') imports.add(name);
    }
  }

  if (exports.size === 0 && imports.size === 0) {
    /*
     * Nothing built and nothing planned. Named rather than dropped — `nexusTrade` lists it under
     * `unplanned`, because a system quietly missing from its own group reads as a bug, and saying
     * so is also the nudge to go and plan it.
     */
    return { systemName: input.systemName, exports: [], imports: [], basis: 'unknown' };
  }

  return {
    systemName: input.systemName,
    exports: [...exports].sort(),
    imports: [...imports].sort(),
    basis: 'predicted' satisfies NexusBasis,
  };
}
