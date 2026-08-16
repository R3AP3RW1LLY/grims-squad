/**
 * Where to send somebody to buy the rest of a build.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "under this section: Where the squadron has bought it it must always show in this priority,
 * materials available in the system the build is happening, 2. materials available in stations in
 * systems that are architected by squadron members, 3. all other locations that hold materials we
 * can access, the priority is on orbital stations, followed by ground stations. and it must always
 * be closest to the build system!"
 *
 * ★ WHY NOT SIMPLY NEAREST FIRST ★
 *
 * Because light years are not what the trip costs.
 *
 * Buying in the build's OWN system is no jump at all — load and dock. A station eight light years
 * out is not "nearly as good"; it is a return trip with a full hold, and for a Refinery Hub's
 * twenty-odd thousand tonnes that is the difference between an evening and a week.
 *
 * A system a member architected ranks next for a reason unrelated to distance: the squadron decides
 * what gets built there, members already fly through it, and its market is one we can keep stocked.
 * A neutral station at the same range is a market nobody can influence, described by EDDN data that
 * may be months old.
 *
 * ★ AND WHY ORBITAL OUTRANKS GROUND, BUT ONLY INSIDE A BAND ★
 *
 * A ground station is a descent, a landing, a pad walk and a launch on every single run — over a
 * twenty-run haul that costs far more than a few light years. So convenience beats distance. It does
 * NOT beat the band, because no amount of convenience makes a distant orbital station better than a
 * dock in the system being built.
 *
 * ★ LIVES HERE SO BOTH SURFACES CANNOT DISAGREE ★
 *
 * The same reasoning as `rankOpportunities`: the website and the companion app both call this, so
 * one member reading the app and another reading the site are sent to the same station. Two
 * implementations of one ordering is how they quietly stop agreeing.
 */

export interface BuySource {
  readonly stationName: string;
  /** The STATION's system, never the build's. */
  readonly systemName: string;
  /** Light years from the build. Null when we cannot place one end of the trip. */
  readonly distanceLy: number | null;
  /** Null when we do not know what kind of port it is. Treated as ground — see `convenience`. */
  readonly isOrbital: boolean | null;
}

export interface BuyContext {
  readonly buildSystem: string;
  /**
   * Systems the squadron architected.
   *
   * Two sources feed this, and the owner asked for both: the colonisation plans, which are the
   * systems we are actively building out, and an officer-maintained list, which covers the ones we
   * hold but never planned here. Either alone would miss real squadron space.
   */
  readonly architectedSystems: ReadonlySet<string>;
}

/**
 * Elite spells one system three ways depending on who is reporting it — EDDN, Inara, and a member
 * typing it into a box. A case-sensitive comparison would drop the build's own system out of the
 * first band, which is the one thing this ordering exists to get right.
 */
const key = (name: string): string => name.trim().toLowerCase();

/** 0 = the build's own system, 1 = squadron-architected, 2 = everywhere else. */
function band(source: BuySource, context: BuyContext): number {
  const system = key(source.systemName);

  /*
   * Checked before the architected set, and it matters: a build in a system the squadron architected
   * is the ORDINARY case, not an edge one. Testing membership first would rank the build's own
   * system as merely second.
   */
  if (system === key(context.buildSystem)) return 0;

  for (const architected of context.architectedSystems) {
    if (key(architected) === system) return 1;
  }

  return 2;
}

/**
 * 0 for orbital, 1 for ground OR unknown.
 *
 * Unknown sits with ground deliberately. Guessing generously would send a member on a descent they
 * were told they would not make; guessing meanly costs them a station that turns out to be better
 * than advertised. The cost of being wrong is asymmetric, so the unknown takes the pessimistic side.
 */
const convenience = (source: BuySource): number => (source.isOrbital === true ? 0 : 1);

/**
 * Distance, with the unplaceable pushed to the end.
 *
 * `null` in a numeric comparison coerces to zero, which would promote every station we know least
 * about to the top of a list whose whole purpose is closeness. Infinity is the honest answer: we
 * cannot say how far it is, so it cannot be the nearest.
 */
const reach = (source: BuySource): number =>
  source.distanceLy === null ? Number.POSITIVE_INFINITY : source.distanceLy;

/**
 * Ranks, never filters.
 *
 * A station that comes last is still somewhere a member could go, and a list that silently dropped
 * the only stop holding one commodity would send somebody home empty. Sorting a copy, because the
 * caller's array is React state on both surfaces and sorting in place is how a list re-renders into
 * a different order than the one it was rendered from.
 */
export function rankBuySources(
  sources: readonly BuySource[],
  context: BuyContext,
): readonly BuySource[] {
  return [...sources].sort((a, b) => {
    const byBand = band(a, context) - band(b, context);
    if (byBand !== 0) return byBand;

    const byKind = convenience(a) - convenience(b);
    if (byKind !== 0) return byKind;

    // Array.prototype.sort is stable in every engine this runs on, so a genuine tie keeps the order
    // it arrived in — the list must not shuffle between two identical reads.
    return reach(a) - reach(b);
  });
}
