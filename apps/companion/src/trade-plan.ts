import type { Pick as ManifestPick } from '@grims/shared/manifest';

/**
 * The run a member picked in the Freight Office, carried to the overlay and back across restarts.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "add an option to choose the trade route and display them in the overlay please so we can group
 * multiple routes together if there are several that are going to the same destination, and show
 * the optimized order"
 *
 * ★ THE PANEL HAS SAID "PICK A RUN IN THE FREIGHT OFFICE" SINCE IT WAS WRITTEN ★
 *
 * And it was right to: nothing anywhere recorded what a member chose. The planner computed
 * candidates and forgot them the moment the page changed. This is the missing record, and it is
 * deliberately the PICKS rather than a finished manifest — capacity changes when somebody swaps
 * ship, and a manifest baked at pick time would quietly plan for the wrong hold ever after.
 */

/** A run the member picked. The same shape `planManifest` consumes, which is not a coincidence. */
export type PickedRun = ManifestPick;

/** Everything a stop needs. A pick missing any of it cannot be flown, so it is dropped on read. */
function usable(v: unknown): v is PickedRun {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p['commodity'] === 'string' &&
    typeof p['buyStation'] === 'string' &&
    typeof p['buySystem'] === 'string' &&
    typeof p['sellStation'] === 'string' &&
    typeof p['sellSystem'] === 'string' &&
    typeof p['buyPrice'] === 'number' &&
    typeof p['profitPerTonne'] === 'number' &&
    typeof p['supply'] === 'number' &&
    typeof p['demand'] === 'number'
  );
}

function coordsOf(raw: unknown): { x: number; y: number; z: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  return typeof c['x'] === 'number' && typeof c['y'] === 'number' && typeof c['z'] === 'number'
    ? { x: c['x'], y: c['y'], z: c['z'] }
    : null;
}

/**
 * Read the plan out of the string the config holds.
 *
 * Never throws. A member who has never picked, a config written before this existed, and a file
 * somebody hand-edited all land here, and the overlay's own empty sentence is the right answer for
 * every one of them — a crash on startup is not.
 */
export function readTradePlan(json: string | null): PickedRun[] {
  if (json === null || json.trim() === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null) return [];
  const raw = (parsed as Record<string, unknown>)['picks'];
  if (!Array.isArray(raw)) return [];

  const out: PickedRun[] = [];
  for (const entry of raw as unknown[]) {
    if (!usable(entry)) continue;
    const p = entry as unknown as Record<string, unknown>;

    /*
     * Rebuilt field by field rather than spread. A config written by a newer version may carry
     * anything at all, and passing unknown keys into the manifest would let a future field change
     * the plan silently on an older build.
     */
    out.push({
      commodity: p['commodity'] as string,
      buyStation: p['buyStation'] as string,
      buySystem: p['buySystem'] as string,
      sellStation: p['sellStation'] as string,
      sellSystem: p['sellSystem'] as string,
      buyPrice: p['buyPrice'] as number,
      profitPerTonne: p['profitPerTonne'] as number,
      supply: p['supply'] as number,
      demand: p['demand'] as number,
      buyDistanceLy: typeof p['buyDistanceLy'] === 'number' ? p['buyDistanceLy'] : 0,
      buyCoords: coordsOf(p['buyCoords']),
    });
  }

  return out;
}

/**
 * Where the member was planning FROM.
 *
 * ★ WITHOUT IT THERE IS NO OPTIMISED ORDER, ONLY A GROUPING ★
 *
 * `planManifest` orders the stops as a shortest path from an origin; with no origin it can only
 * group them by system. The journal tells us the station a member is docked at but not where that
 * is in space, so the origin has to travel WITH the plan — it is the position the Freight Office
 * measured everything from, which is exactly the right anchor for the order it produced.
 */
export function readPlanOrigin(json: string | null): { x: number; y: number; z: number } | null {
  if (json === null || json.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return coordsOf((parsed as Record<string, unknown>)['origin']);
  } catch {
    return null;
  }
}

/** Serialise for the config. Wrapped in an object so the format can gain fields later. */
export function writeTradePlan(
  picks: readonly PickedRun[],
  origin: { x: number; y: number; z: number } | null = null,
): string {
  return JSON.stringify({ picks, origin });
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export interface PlanPosition {
  /** Picks whose PICKUP is this station. */
  readonly loadHere: readonly PickedRun[];
  /** Picks whose SALE is this station. */
  readonly sellHere: readonly PickedRun[];
}

/**
 * What the member should do at the station they are actually docked at.
 *
 * ★ BOTH ANSWERS, NEVER ONE ★
 *
 * A chained run sells at a station and loads the next leg there — that is exactly the case the
 * owner described, several routes sharing a destination. A panel that showed only the sale would
 * have somebody undock having done half the job, and only the pickup would have them fly off still
 * carrying the last load.
 */
export function whereInPlan(
  picks: readonly PickedRun[],
  dock: { stationName: string | null; systemName: string | null } | null,
): PlanPosition {
  const station = dock?.stationName ?? null;
  const system = dock?.systemName ?? null;
  if (station === null || system === null) return { loadHere: [], sellHere: [] };

  /*
   * Station AND system. Station names repeat across the galaxy — there is more than one "Watson
   * Terminal" — and matching on the name alone would tell a member to load cargo four hundred light
   * years from the pickup.
   */
  return {
    loadHere: picks.filter((p) => same(p.buyStation, station) && same(p.buySystem, system)),
    sellHere: picks.filter((p) => same(p.sellStation, station) && same(p.sellSystem, system)),
  };
}
