import { describe, expect, it } from 'vitest';
import { completedBuilds, type WatchedBuild, type StationSighting } from './build-completion-watch.js';

/**
 * Noticing that a build finished when nobody told us.
 *
 * ★ SQUADRON OWNER ★
 *
 * "also check inara every 20 minutes agains our current builds please and if a build is completed
 * then close the project as completed"
 *
 * and, on why it matters:
 *
 * "someone without the companion app completed a project and it did not update, thats what we need
 * the safeguard for!" — because an open project that is actually finished sends members to buy
 * materials for a station that no longer needs them.
 *
 * ★ IT PULLS FROM cAPI — SQUADRON OWNER, 2026-08-16: "no it needs to pull from CAPI!" ★
 *
 * Inara was the original ask and cannot answer it: their API has commander profiles and no station
 * or colonisation endpoint at all.
 *
 * Frontier can. The journal poller now reads every linked member's journal straight from Frontier,
 * and those carry `ColonisationConstructionDepot` — the site's own statement of what it still wants
 * — and `Docked`, which names the station type at that market id. Frontier's own answer about
 * Frontier's own site, and it reaches cloud players EDDN never would.
 *
 * ★ IT MUST BE HARDER TO CLOSE A BUILD THAN TO LEAVE IT OPEN ★
 *
 * Closing a live build is the expensive mistake: the board stops asking for materials the site
 * genuinely still needs, and the members hauling to it are told to stop. Leaving a finished one open
 * costs a wasted trip. Both are bad; only one is silent, so every rule below leans the same way.
 */

const AT = new Date('2026-08-16T12:00:00Z');
const EARLIER = new Date('2026-08-16T09:00:00Z');

const build = (over: Partial<WatchedBuild> = {}): WatchedBuild => ({
  projectId: over.projectId ?? 'p1',
  marketId: over.marketId ?? '3700001',
  systemName: over.systemName ?? 'Col 285 Sector',
  completedAt: over.completedAt === undefined ? null : over.completedAt,
  remaining: over.remaining === undefined ? 0 : over.remaining,
});

const seen = (over: Partial<StationSighting> = {}): StationSighting => ({
  marketId: over.marketId ?? '3700001',
  stationType: over.stationType === undefined ? 'Coriolis Starport' : over.stationType,
  observedAt: over.observedAt ?? AT,
});

describe('a site that has become a station', () => {
  it('★ MANDATORY: a finished site with nothing outstanding is closed ★', () => {
    /*
     * The case this exists for. Somebody without the companion app delivered the last load, the
     * depot went to zero, and a linked member's journal now shows a real station at that market id
     * — but nothing on our side noticed, so the board went on asking for materials.
     */
    const out = completedBuilds([build({ remaining: 0 })], [seen()], AT);

    expect(out.map((c) => c.projectId)).toEqual(['p1']);
  });

  it('★ MANDATORY: a site that still WANTS materials is never closed ★', () => {
    /*
     * The expensive mistake, and the reason this is not simply "a station appeared".
     *
     * A construction depot can be sighted under a station type while the build is still running —
     * and closing on that alone would stop the board asking for materials the site genuinely needs,
     * telling everybody mid-haul to turn around. Outstanding tonnage beats any sighting.
     */
    const out = completedBuilds([build({ remaining: 4_200 })], [seen()], AT);

    expect(out).toEqual([]);
  });

  it('★ MANDATORY: a construction depot sighting is not a finished station ★', () => {
    /*
     * The site reports itself as a depot for the WHOLE build. Treating that as completion would
     * close every project the moment anybody docked at it, which is the opposite of the feature.
     */
    for (const type of ['Space Construction Depot', 'Planetary Construction Depot']) {
      expect(completedBuilds([build()], [seen({ stationType: type })], AT)).toEqual([]);
    }
  });

  it('★ MANDATORY: a station type we do not recognise does NOT close a build ★', () => {
    /*
     * ★ FOUND BY MUTATION TESTING ★
     *
     * Every other case here used `null` or a known depot, so the rule could be replaced with
     * "anything non-null counts" and the whole suite stayed green. That mutation is exactly what
     * Frontier shipping a new station kind looks like — and it would close every finished-looking
     * build at once, silently, the first time one appeared.
     *
     * Unknown means unknown. `isOrbitalStation` reports null for it, and null must not be evidence.
     */
    const out = completedBuilds([build()], [seen({ stationType: 'Something Frontier Added Tuesday' })], AT);

    expect(out).toEqual([]);
  });

  it('a sighting with no type at all is not enough', () => {
    // We cannot tell a finished station from the depot it used to be. Silence beats a guess that
    // closes a live build.
    expect(completedBuilds([build()], [seen({ stationType: null })], AT)).toEqual([]);
  });
});

describe('what is left alone', () => {
  it('★ MANDATORY: an already-closed project is not closed again ★', () => {
    /*
     * Closing announces itself — the squadron feed, and a personal row for everybody on the build.
     * Re-closing would re-announce a completion that happened days ago, every twenty minutes.
     */
    const out = completedBuilds([build({ completedAt: EARLIER })], [seen()], AT);

    expect(out).toEqual([]);
  });

  it('★ MANDATORY: a build with no sighting is left open ★', () => {
    // Absence of evidence. Most builds have no station because they are not finished.
    expect(completedBuilds([build()], [], AT)).toEqual([]);
  });

  it('a sighting for a DIFFERENT market does not close this build', () => {
    // Market id is the identity. Matching on system alone would close a build because a neighbour
    // in the same system finished.
    expect(completedBuilds([build({ marketId: '3700001' })], [seen({ marketId: '3700002' })], AT)).toEqual([]);
  });
});

describe('what the caller is told', () => {
  it('MANDATORY: it reports WHEN the station was seen, not when we looked', () => {
    /*
     * The completion timestamp goes on the record and into the feed. Stamping the sweep's own clock
     * would date every build to whenever the job happened to run, which is a fact about our cron
     * rather than about the build.
     */
    const out = completedBuilds([build()], [seen({ observedAt: EARLIER })], AT);

    expect(out[0]?.at).toEqual(EARLIER);
  });

  it('MANDATORY: it says which sighting convinced it', () => {
    // The close is audited and announced. "Because a Coriolis Starport appeared at this market id"
    // is a reason an officer can check; "the job decided so" is not.
    expect(completedBuilds([build()], [seen()], AT)[0]?.becauseSaw).toBe('Coriolis Starport');
  });

  it('closes several at once without confusing them', () => {
    const out = completedBuilds(
      [build({ projectId: 'a', marketId: '1' }), build({ projectId: 'b', marketId: '2' })],
      [seen({ marketId: '2' }), seen({ marketId: '1' })],
      AT,
    );

    expect(out.map((c) => c.projectId).sort()).toEqual(['a', 'b']);
  });
});
