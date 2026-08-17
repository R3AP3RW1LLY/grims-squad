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
  /**
   * Whose station this is.
   *
   * ★ SQUADRON OWNER, 2026-08-17 ★
   *
   * "the buy locations should be accurate based on the following criteria. 1 squadron owned
   * stations, 2. squadron owned members stations, then closest stations to the build project"
   *
   * `null` is "not ours, or we do not know" — the honest default for the ~318,000 stations in the
   * catalogue we have no claim on. It is deliberately not `'neutral'`: an absent claim and a
   * positive statement that a station is somebody else's are different facts, and only one of them
   * is something this platform can actually assert.
   */
  readonly ownership: StationOwnership | null;
}

/**
 * Whose a station is, for ranking.
 *
 * Two sources feed it, and the owner asked for both: stations the squadron BUILT through
 * colonisation, which is derivable and cannot go stale, and an officer's own list, which covers the
 * ones we hold but never built here. Either alone would miss real squadron property.
 */
export type StationOwnership = 'squadron' | 'member';

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
  /**
   * Which ordering the member asked for.
   *
   * ★ THE OWNER CHOSE A TOGGLE, NOT A DEFAULT — SQUADRON OWNER, 2026-08-17 ★
   *
   * Asked whether a squadron station 200 ly away should outrank a neutral one 10 ly away, the answer
   * was: show both orderings and let the member choose. That is the right call — the answer genuinely
   * depends on the trip, and picking one would be wrong half the time.
   *
   * `ours` puts squadron property first whatever the distance. `closest` sorts by distance and uses
   * ownership only to break ties, so a member in a hurry is never sent across the bubble to shop at
   * home.
   */
  readonly order?: 'ours' | 'closest' | undefined;
}

/**
 * Elite spells one system three ways depending on who is reporting it — EDDN, Inara, and a member
 * typing it into a box. A case-sensitive comparison would drop the build's own system out of the
 * first band, which is the one thing this ordering exists to get right.
 */
const key = (name: string): string => name.trim().toLowerCase();

/**
 * 0 = the squadron's own station, 1 = a member's, 2 = the build's own system,
 * 3 = squadron-architected, 4 = everywhere else.
 *
 * ★ OWNERSHIP OUTRANKS GEOGRAPHY, IN `ours` MODE ★
 *
 * Ours before a member's before anything else, because "we already own the pad" is a stronger reason
 * to fly somewhere than "it is nearby" — the squadron's own market is the one whose stock and prices
 * the squadron controls.
 *
 * The system bands below it are unchanged and still matter: among stations nobody owns, the build's
 * own system beats architected space beats the rest of the bubble.
 */
function band(source: BuySource, context: BuyContext): number {
  const system = key(source.systemName);

  /*
   * ★ THE BUILD'S OWN SYSTEM LEADS — SQUADRON OWNER, 2026-08-17 ★
   *
   * "the buy locations ordering should be as follows: 2, 0, 1, 3, 4"
   *
   * Checked BEFORE ownership, and the order was the other way round an hour ago. A station in the
   * system somebody is building in needs no jump at all, and no amount of owning a pad elsewhere
   * beats already being there — the shortest run is the one you do not fly.
   *
   * Ownership then decides among everywhere else, which is where it actually earns its place.
   */
  if (system === key(context.buildSystem)) return 0;

  if (source.ownership === 'squadron') return 1;
  if (source.ownership === 'member') return 2;

  /*
   * Checked before the architected set, and it matters: a build in a system the squadron architected
   * is the ORDINARY case, not an edge one. Testing membership first would rank the build's own
   * system as merely second.
   */
  for (const architected of context.architectedSystems) {
    if (key(architected) === system) return 3;
  }

  return 4;
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
    /*
     * ★ CLOSEST FIRST INVERTS THE TWO KEYS, IT DOES NOT DISCARD OWNERSHIP ★
     *
     * A member who asked for the nearest station still wants ours when two are equally close — that
     * is a free preference, and throwing it away would make the toggle feel like it turned something
     * off rather than reordered it.
     */
    if (context.order === 'closest') {
      const byReach = reach(a) - reach(b);
      if (byReach !== 0) return byReach;
      return band(a, context) - band(b, context);
    }

    const byBand = band(a, context) - band(b, context);
    if (byBand !== 0) return byBand;

    const byKind = convenience(a) - convenience(b);
    if (byKind !== 0) return byKind;

    // Array.prototype.sort is stable in every engine this runs on, so a genuine tie keeps the order
    // it arrived in — the list must not shuffle between two identical reads.
    return reach(a) - reach(b);
  });
}
