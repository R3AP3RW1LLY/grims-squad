/**
 * The galaxy's uninhabited half.
 *
 * ★ WHY THIS HAD TO EXIST ★
 *
 * The colonisation scout needs CLAIMABLE systems — uninhabited, unlocked — and our own galaxy table
 * cannot supply them. It holds 303,816 systems, but they are the populated ones plus wherever
 * members have actually flown. Measured against the squadron's own permit office: our table has
 * seven systems within twenty light years and every one is inhabited. Spansh has seventeen
 * claimable ones inside sixteen.
 *
 * That gap is not a bug in the ingest. Recording every empty system in the bubble would be tens of
 * millions of rows to answer a question asked a few times a year, which is exactly the reasoning
 * `colony_bodies` already uses for body detail: fetch on demand, cache what was asked for.
 *
 * ★ WHAT WE STILL ANSWER OURSELVES ★
 *
 * Permit sources. Those are populated systems with stations, which our table covers well — 314,650
 * stations — so the question "where do I buy the claim, and whose is it" never leaves the building.
 */

export interface SpanshSystem {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Distance from the reference system, in light years. */
  readonly distance: number;
  readonly population: number;
  readonly bodyCount: number;
  readonly allegiance: string | null;
  readonly primaryEconomy: string | null;
  /** True only when Spansh says so; absent means not colonised. */
  readonly isColonised: boolean;
  readonly needsPermit: boolean;
  readonly stationCount: number;
}

export interface SpanshOptions {
  readonly fetchImpl?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
  /** Pages of 50. Bounded so a wide search cannot run away. */
  readonly maxPages?: number | undefined;
}

const ENDPOINT = 'https://spansh.co.uk/api/systems/search';

/**
 * Identify ourselves.
 *
 * Node's default user agent is filtered by their edge, which returns an HTML error page that then
 * fails to parse as JSON — an opaque failure that cost real time to diagnose. Naming the tool is
 * also simply the polite thing to do against somebody else's free service.
 */
const USER_AGENT = "GrimsSquadHub/1.0 (Elite Dangerous squadron tool; +https://grims-squad.com)";

interface RawRow {
  name?: unknown;
  x?: unknown;
  y?: unknown;
  z?: unknown;
  distance?: unknown;
  population?: unknown;
  body_count?: unknown;
  allegiance?: unknown;
  primary_economy?: unknown;
  is_colonised?: unknown;
  needs_permit?: unknown;
  stations?: unknown;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Why a sweep stopped early. `page-cap` is our own limit; the rest are the service's. */
export type SweepFailure = 'timeout' | 'http' | 'network' | 'page-cap';

/**
 * What a sweep found, AND whether that is all of it.
 *
 * ★ THE ANSWER CARRIES ITS OWN COMPLETENESS — SQUADRON OWNER, 2026-08-22 ★
 *
 * "the scouting system in the colonization module is now no longer finding anything"
 *
 * This used to return a bare `SpanshSystem[]`. Every failure path was `break`, so a stalled first
 * page produced `[]` — the identical value a genuinely empty region produces. The scout rendered it
 * as "Nothing claimable in range" and a member was told the galaxy was empty when the truth was
 * that we never managed to ask.
 *
 * The type is the fix. A caller cannot forget to check a field it has to destructure past, and
 * `complete` has no sensible default that hides a truncation.
 */
export interface SpanshSweep {
  readonly systems: SpanshSystem[];
  /** False when anything was missed — a failure, or our own page cap. */
  readonly complete: boolean;
  readonly pagesFetched: number;
  /** Null exactly when `complete` is true. */
  readonly failure: SweepFailure | null;
}

/** An abort reads as a timeout; anything else thrown is the network. */
function classify(err: unknown): SweepFailure {
  return err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network';
}

/**
 * Every system inside `radiusLy` of a named system.
 *
 * Returns them all — populated and not — because the caller decides what claimable means and a
 * filter applied here would hide the permit sources sitting in the same sphere.
 */
export async function systemsNear(
  systemName: string,
  radiusLy: number,
  opts: SpanshOptions = {},
): Promise<SpanshSweep> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxPages = opts.maxPages ?? 20;
  const out: SpanshSystem[] = [];
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page += 1) {
    /*
     * ★ ONE RETRY BEFORE ANYTHING IS SAID — SQUADRON OWNER, 2026-08-22 ★
     *
     * The observed failure is a transient stall: the same search that returned nothing after 20
     * seconds returned 48 systems two minutes later. One extra request turns most of these into an
     * ordinary result the member never hears about, which is worth far more than a warning they
     * would learn to click past.
     *
     * Only ONE, though. A member is waiting on this, and three retries against a service that is
     * genuinely down is a minute of staring at a spinner before being told the same thing.
     */
    let rows: RawRow[] | null = null;
    let failure: SweepFailure | null = null;

    for (let attempt = 0; attempt < 2 && rows === null; attempt += 1) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 20_000);

      try {
        const res = await doFetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
          signal: ac.signal,
          body: JSON.stringify({
            filters: { distance: { min: '0', max: String(radiusLy) } },
            sort: [{ distance: { direction: 'asc' } }],
            size: 50,
            page,
            reference_system: systemName,
          }),
        });

        if (!res.ok) {
          failure = 'http';
          continue;
        }
        const body = (await res.json()) as { results?: unknown };
        rows = Array.isArray(body.results) ? (body.results as RawRow[]) : [];
        failure = null;
      } catch (err) {
        failure = classify(err);
      } finally {
        clearTimeout(timer);
      }
    }

    if (rows === null) {
      /*
       * A partial answer still beats none — the scout ranks whatever arrived. What changed is that
       * the list no longer claims to be the whole picture.
       */
      return { systems: out, complete: false, pagesFetched, failure: failure ?? 'network' };
    }

    pagesFetched += 1;

    for (const r of rows) {
      if (typeof r.name !== 'string') continue;
      out.push({
        name: r.name,
        x: num(r.x),
        y: num(r.y),
        z: num(r.z),
        distance: num(r.distance),
        population: num(r.population),
        bodyCount: num(r.body_count),
        allegiance: typeof r.allegiance === 'string' ? r.allegiance : null,
        primaryEconomy: typeof r.primary_economy === 'string' ? r.primary_economy : null,
        /*
         * ★ ONLY EVER `true` OR ABSENT ★
         *
         * Spansh never writes `is_colonised: false`. Testing `=== false` matched nothing and
         * reported zero claimable systems out of 3,208 — the field has to be read as "not true".
         */
        isColonised: r.is_colonised === true,
        needsPermit: r.needs_permit === true,
        stationCount: Array.isArray(r.stations) ? r.stations.length : 0,
      });
    }

    /*
     * A short page is the end of the region — the only way this sweep finishes having seen
     * everything there is to see.
     */
    if (rows.length < 50) {
      return { systems: out, complete: true, pagesFetched, failure: null };
    }
  }

  /*
   * Fell out of the loop with every page full, so the region continues past our own cap.
   *
   * Reported as a truncation rather than a clean finish. It was silent before for exactly the same
   * reason a failed page was: a bare array had nowhere to say so, and "stopped early because we
   * chose to" looks identical to "that is all of them" once the list is on screen.
   */
  return { systems: out, complete: false, pagesFetched, failure: 'page-cap' };
}

/** Uninhabited, unlocked, not already colonised — the set a claim can actually be made in. */
export function claimableOnly(systems: readonly SpanshSystem[]): SpanshSystem[] {
  /*
   * ★ NOTHING DOCKED IN IT — SQUADRON OWNER, 2026-08-12 ★
   *
   * "when were using the scout module, and looking for unclaimed systems its showing us systems
   * that are claimed, we need this fixed ASAP! this is only supposed to find unclaimed systems!"
   *
   * The three tests below were all true of a system claimed an hour earlier: population is still 0,
   * no permit is needed, and `is_colonised` lags. That field is only ever written `true`, so ABSENT
   * reads as unclaimed — the safe direction for an uninhabited system, and the wrong one for a
   * fresh claim.
   *
   * What a fresh claim always has is a System Colonisation Ship docked in it, and a genuinely
   * unclaimed system has NOTHING docked in it at all. So a station count above zero is the
   * observable proof that somebody got there first, and it does not depend on Spansh having caught
   * up with anything.
   *
   * The owner also asked that a system with a System Architect attached be excluded. Spansh exposes
   * no architect, no owner and no claimant — checked against the live API on 2026-08-12, which
   * returns is_colonised, population, stations and nothing about who holds it. The colonisation ship
   * IS how an attached architect shows up in this data, so this is that rule rather than a
   * substitute for it. Cross-checking our own EDDN feed, which may see a claim before Spansh
   * publishes it, is the owner's second choice and is still owed.
   */
  return systems.filter(
    (s) => !s.isColonised && !s.needsPermit && s.population === 0 && s.stationCount === 0,
  );
}
