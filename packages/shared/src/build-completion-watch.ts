import { isOrbitalStation } from './station-orbital.js';

/**
 * Noticing that a build finished when nobody told us.
 *
 * ★ SQUADRON OWNER ★
 *
 * "also check inara every 20 minutes agains our current builds please and if a build is completed
 * then close the project as completed"
 *
 * and why:
 *
 * "someone without the companion app completed a project and it did not update, thats what we need
 * the safeguard for!"
 *
 * ★ IT PULLS FROM cAPI — SQUADRON OWNER, 2026-08-16 ★
 *
 * "no it needs to pull from CAPI!"
 *
 * Inara was the original ask and Inara cannot answer it: their API offers commander profiles and
 * nothing else — no station endpoint, no colonisation endpoint. Polling it every twenty minutes
 * would return the same profiles for ever.
 *
 * Frontier can, and now does. The journal poller reads every linked member's journal directly from
 * Frontier, and those journals carry `ColonisationConstructionDepot` — the site's own statement of
 * what it still wants — and `Docked`, which names the station type at that market id. That is
 * Frontier's own answer about Frontier's own site, not a third party's copy of it.
 *
 * It also reaches the members EDDN never would: somebody on GeForce Now flies past the site, and
 * their journal tells us it finished, without them running anything.
 *
 * ★ EVERY RULE HERE LEANS THE SAME WAY ★
 *
 * Closing a live build is the expensive mistake: the board stops asking for materials the site still
 * needs and the members hauling to it are told to stop, mid-run. Leaving a finished build open costs
 * a wasted trip. Both are bad and only one is silent, so this refuses whenever it is unsure.
 */

export interface WatchedBuild {
  readonly projectId: string;
  /** The site's market id, as a string — it exceeds 2^53. The identity we match on. */
  readonly marketId: string;
  readonly systemName: string;
  readonly completedAt: Date | null;
  /** Tonnes the site still wants. Zero means the depot is satisfied. */
  readonly remaining: number;
}

export interface StationSighting {
  readonly marketId: string;
  /** What kind of port the member's journal says it is, via cAPI. Null when nothing said. */
  readonly stationType: string | null;
  readonly observedAt: Date;
}

export interface CompletedBuild {
  readonly projectId: string;
  /** When the STATION was seen — not when this swept. The completion goes on the record. */
  readonly at: Date;
  /** The station type that convinced it, so the close can be audited and explained. */
  readonly becauseSaw: string;
}

/**
 * A construction depot is what the site reports for the WHOLE build.
 *
 * Treating one as completion would close every project the moment anybody docked at it, which is
 * precisely backwards. `isOrbitalStation` classifies both spellings of both depot kinds, and they
 * are the two that must never count.
 */
function isFinishedStation(type: string | null): boolean {
  if (type === null || type.trim() === '') return false;

  const key = type.trim().toLowerCase().replace(/\s+/g, '');
  if (key.includes('constructiondepot')) return false;

  // A type we do not recognise is not evidence. `isOrbitalStation` returns null for those, and null
  // must not close a build — the same pessimism it already applies to buying decisions.
  return isOrbitalStation(type) !== null;
}

/**
 * Which watched builds have demonstrably finished.
 *
 * Two conditions, and BOTH are required:
 *
 *   the depot wants nothing more   `remaining === 0`
 *   a real station is there now    a sighting that is not a construction depot
 *
 * Either alone is a guess. A depot at zero can still be mid-handover, and a station sighting can be
 * the depot itself under a name we half-recognise. Together they are the same thing a member would
 * conclude by flying there.
 */
export function completedBuilds(
  builds: readonly WatchedBuild[],
  sightings: readonly StationSighting[],
  _now: Date,
): readonly CompletedBuild[] {
  const byMarket = new Map<string, StationSighting>();
  for (const s of sightings) {
    const held = byMarket.get(s.marketId);
    // The newest sighting wins: a site seen as a depot yesterday and a starport today is finished.
    if (held === undefined || s.observedAt > held.observedAt) byMarket.set(s.marketId, s);
  }

  const done: CompletedBuild[] = [];

  for (const build of builds) {
    // Closing announces itself — the feed, and a personal row for everybody on the build. Doing it
    // twice would re-announce a completion from days ago, every twenty minutes, for ever.
    if (build.completedAt !== null) continue;

    // Outstanding tonnage beats any sighting. This is the clause that stops a live build being
    // closed out from under the people hauling to it.
    if (build.remaining > 0) continue;

    const seen = byMarket.get(build.marketId);
    if (seen === undefined || !isFinishedStation(seen.stationType)) continue;

    done.push({
      projectId: build.projectId,
      at: seen.observedAt,
      becauseSaw: seen.stationType as string,
    });
  }

  return done;
}
