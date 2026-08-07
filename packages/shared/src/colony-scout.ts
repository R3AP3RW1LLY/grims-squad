/**
 * Choosing where to colonise next.
 *
 * ★ SQUADRON OWNER, 2026-08-07 ★
 *
 * "can we build a tool into our web and companion app that literally does what we just did here for
 * this planning and research and system selection?"
 *
 * This is the selection half; `colony-plan-check.ts` is the building half.
 *
 * ★ THREE THINGS A SPREADSHEET GETS WRONG ★
 *
 * Working this by hand over an afternoon, the same three errors kept appearing:
 *
 *  1. Ranking on BODY COUNT. The biggest system in the pocket had 26 bodies and 17 landable — all
 *     of them 193,600 Ls from the star. It topped every list until arrival distance was read.
 *  2. Forgetting the PERMIT. A perfect system with no station in claim range cannot be taken at all,
 *     which makes it worth less than a mediocre one that can.
 *  3. Ignoring WHOSE station sells the permit. The claim extends that power. A closer Alliance
 *     office works mechanically and quietly undoes a Federal expansion.
 */

/** How far a colonisation claim reaches from the station selling it. */
export const CLAIM_RANGE_LY = 15;

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A populated system that could sell a colonisation ship. */
export interface PermitSource extends Point {
  readonly system: string;
  readonly allegiance: string | null;
  readonly controllingFaction: string | null;
  readonly stationCount: number;
  /** Orbital ports are where a colonisation contact actually sits. */
  readonly hasOrbital: boolean;
}

export interface ScoutCandidate extends Point {
  readonly system: string;
  readonly bodyCount: number;
  readonly landableCount: number;
  /** Arrival distance of the closest landable body. Null when nothing can be landed on. */
  readonly nearestLandableLs: number | null;
  /** Hotspot counts by material, deduplicated per ring. */
  readonly hotspots: Readonly<Record<string, number>>;
  /**
   * Whether the body survey has actually run for this system.
   *
   * ★ UNKNOWN IS NOT ZERO ★
   *
   * The candidate search returns systems long before anything is known about their bodies. Scoring
   * an unsurveyed system as though it had no landable bodies buried EVERY fresh candidate under a
   * forty-point penalty and made the whole list negative — which reads as "all of these are bad"
   * rather than "none of these have been looked at yet".
   */
  readonly surveyed: boolean;
  readonly pristine: boolean;
  /** Where the permit would be bought. Null means this cannot be claimed at all. */
  readonly permit: PermitSource | null;
  readonly permitLy: number | null;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export interface PermitOptions {
  /** Extend this power. A matching source wins even when a closer one exists. */
  readonly prefer?: string | undefined;
  readonly rangeLy?: number | undefined;
}

/**
 * Where to buy the claim for a system at this point.
 *
 * ★ A STATION IS REQUIRED, NOT JUST A POPULATION ★
 *
 * An inhabited system with no station sells nothing. Proximity alone picks those, which is why the
 * filter comes before the sort rather than after it.
 */
export function bestPermitSource(
  at: Point,
  sources: readonly PermitSource[],
  opts: PermitOptions = {},
): PermitSource | null {
  const range = opts.rangeLy ?? CLAIM_RANGE_LY;

  const reachable = sources
    .filter((s) => s.stationCount > 0)
    .map((s) => ({ source: s, ly: distance(at, s) }))
    .filter((s) => s.ly <= range)
    .sort((a, b) => a.ly - b.ly);

  if (reachable.length === 0) return null;

  /*
   * The preferred allegiance wins outright, however much further it is — inside claim range,
   * distance to the office is a one-off errand, and the power you extend is permanent.
   */
  if (opts.prefer !== undefined) {
    const match = reachable.find(
      (s) => s.source.allegiance?.toLowerCase() === opts.prefer?.toLowerCase(),
    );
    if (match !== undefined) return match.source;
  }

  return reachable[0]?.source ?? null;
}

/**
 * How good a candidate is, as one number.
 *
 * Negative means "cannot be claimed", which is a different thing from "poor" and must never sort
 * among the merely mediocre.
 */
export function scoreCandidate(c: ScoutCandidate): number {
  // No permit, no colony. Nothing else about the system can compensate.
  if (c.permit === null || c.permitLy === null) return -1000;

  let score = 0;

  /*
   * ★ ARRIVAL DISTANCE DISCOUNTS THE CAPACITY, IT DOES NOT SIT BESIDE IT ★
   *
   * The first version of this scorer subtracted a flat penalty for distance and added points per
   * landable body. Run against real systems it ranked Col 285 Sector GL-W c2-13 second — seventeen
   * landable bodies, EVERY ONE of them 193,600 Ls from the star. Seventeen bodies you will never
   * visit twice are not seventeen bodies; the flat penalty was swamped by the count it was meant to
   * discipline.
   *
   * So accessibility multiplies capacity. A far system does not lose a fixed number of points, it
   * loses most of the value of everything it contains, which is what is actually true.
   */
  const ls = c.nearestLandableLs;

  /*
   * An unsurveyed system is scored on what we DO know — its body count — at a neutral reach, and
   * nothing is assumed about bodies nobody has looked at. Surveying it later can only move it.
   */
  const reach = !c.surveyed
    ? 0.6
    : ls === null
      ? 0
      : ls < 1_000
        ? 1
        : ls < 5_000
          ? 0.9
          : ls < 25_000
            ? 0.55
            : ls < 100_000
              ? 0.2
              : 0.08;

  /*
   * ★ LANDABLE BODIES ARE THE REAL CAPACITY ★
   *
   * A body you cannot land on hosts orbital structures only. Landables carry the settlements and
   * hubs, so they are worth several times a bare body — but only if you can get to them.
   */
  score += c.landableCount * 6 * reach;
  score += Math.min(c.bodyCount, 60) * (0.4 + 0.6 * reach);

  // A flat bonus on top for genuinely doorstep systems, where the whole colony is one approach.
  if (c.surveyed && ls !== null && ls < 1_000) score += 15;
  // Only a SURVEYED system can be known to have nothing worth landing on.
  if (c.surveyed && ls === null) score -= 40;

  if (c.pristine) score += 15;

  // Hotspots are a bonus, deliberately capped: a rich ring cannot rescue an unbuildable system.
  const hotspotTotal = Object.values(c.hotspots).reduce((sum, n) => sum + n, 0);
  score += Math.min(hotspotTotal, 20);

  /*
   * A permit source at the very edge of range is fragile — a slightly-off measurement or a claim
   * mechanic we have mis-modelled turns it into no claim at all. Comfort is worth points.
   */
  score -= Math.max(0, c.permitLy - 8) * 1.5;

  return score;
}

/** Rank candidates, best first. */
export function rankCandidates(candidates: readonly ScoutCandidate[]): ScoutCandidate[] {
  return [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
}
