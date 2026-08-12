import { describe, expect, it } from 'vitest';
import { matchProjectToSite, type LinkCandidateSite, type LinkableProject } from './colony-plan-link.js';

/**
 * Which planned structure a real construction site actually IS.
 *
 * ★ SQUADRON OWNER, 2026-08-11 ★
 *
 * "we also need a way to update Build plans so that when we start one through the members or
 * squadron projects that it updates the build plan we have ... this should all be automatic and it
 * should backfill existing build plans based on projects the commander has started"
 *
 * ★ THE COLUMN HAS BEEN THERE ALL ALONG ★
 *
 * `colony_plan_sites.project_id` exists, with the comment "Set once this intention became a real
 * construction site, so a plan can show its own progress" — and nothing has ever set it. 0 of 81
 * sites were linked in production. The three-state progress model reads it and has therefore always
 * reported every site as planned.
 *
 * ★ WHY IT MATCHES ON BUILD TYPE AND NOT ON BODY ★
 *
 * A project does not know which body it sits on. It has a market id, a system, a station name and a
 * bill of materials; the body is not on the record. What it DOES have is the catalogue row its
 * requirement fingerprints to — twenty-odd commodities at exact tonnages, which no two build types
 * share — so "this is an Ocellus Starport in this system" is known with certainty.
 *
 * So the rule is system + build type, and when a system plans two of the same structure it refuses
 * to guess. A wrong link makes a plan claim a build is finished that nobody has started, on the
 * page a squadron uses to decide what to fly tonight.
 */

const site = (over: Partial<LinkCandidateSite> = {}): LinkCandidateSite => ({
  id: over.id ?? 's1',
  buildTypeId: over.buildTypeId === undefined ? 'silenus' : over.buildTypeId,
  projectId: over.projectId === undefined ? null : over.projectId,
  bodyDistanceLs: over.bodyDistanceLs === undefined ? null : over.bodyDistanceLs,
  position: over.position ?? 0,
});

const project = (over: Partial<LinkableProject> = {}): LinkableProject => ({
  id: over.id ?? 'p1',
  buildTypeId: over.buildTypeId === undefined ? 'silenus' : over.buildTypeId,
  arrivalLs: over.arrivalLs === undefined ? null : over.arrivalLs,
});

describe('linking a construction site to the plan that intended it', () => {
  it('★ MANDATORY: exactly one candidate links, with no human involved ★', () => {
    const out = matchProjectToSite(project(), [site({ id: 'a' })]);

    expect(out.kind).toBe('linked');
    expect(out.kind === 'linked' ? out.siteId : null).toBe('a');
  });

  it('★ MANDATORY: two of the same structure planned REFUSES to guess ★', () => {
    /*
     * The real case. GL-W c2-12 plans six Refinery Hubs; a project for one of them could be any of
     * them, and picking the first would mark the wrong body built. The member is asked instead —
     * which is a two-second tap, against a plan that lies until somebody notices.
     */
    const out = matchProjectToSite(project(), [site({ id: 'a' }), site({ id: 'b' })]);

    expect(out.kind).toBe('ambiguous');
    expect(out.kind === 'ambiguous' ? out.siteIds : []).toEqual(['a', 'b']);
  });

  it('★ MANDATORY: a site already linked to something else is not a candidate ★', () => {
    // Otherwise the second Refinery Hub to be started would steal the first one's row, and the
    // plan would show one built where two are under way.
    const out = matchProjectToSite(project({ id: 'p2' }), [
      site({ id: 'a', projectId: 'p1' }),
      site({ id: 'b' }),
    ]);

    expect(out.kind).toBe('linked');
    expect(out.kind === 'linked' ? out.siteId : null).toBe('b');
  });

  it('★ MANDATORY: a project nobody has docked at yet cannot be identified, and links nothing ★', () => {
    /*
     * `buildTypeId` comes from fingerprinting the bill of materials, and a site reports nothing
     * until a commander docks. Guessing from the free-text name somebody typed is how a Refinery Hub
     * becomes an Ocellus Starport.
     */
    const out = matchProjectToSite(project({ buildTypeId: null }), [site({ id: 'a' })]);

    expect(out.kind).toBe('none');
    expect(out.kind === 'none' ? out.why : '').toMatch(/identif/i);
  });

  it('★ MANDATORY: it is idempotent — re-running finds the link it already made ★', () => {
    /*
     * The backfill runs as a dry run, then for real, and possibly again by somebody checking. A
     * second pass must not create a second link or report a conflict with itself.
     */
    const out = matchProjectToSite(project({ id: 'p1' }), [site({ id: 'a', projectId: 'p1' })]);

    expect(out.kind).toBe('linked');
    expect(out.kind === 'linked' ? out.siteId : null).toBe('a');
  });

  it('MANDATORY: a build type the plan never intended links nothing', () => {
    // Somebody started a structure that is not in the plan. That is information, not an error — and
    // silently attaching it to an unrelated row would be worse than leaving it unlinked.
    const out = matchProjectToSite(project({ buildTypeId: 'zeus' }), [
      site({ id: 'a', buildTypeId: 'silenus' }),
    ]);

    expect(out.kind).toBe('none');
    expect(out.kind === 'none' ? out.why : '').toMatch(/plan/i);
  });

  it('MANDATORY: a site with no build type chosen is never a candidate', () => {
    // An empty row in the plan is an intention nobody has decided yet. It cannot be "already built".
    const out = matchProjectToSite(project(), [site({ id: 'a', buildTypeId: null })]);
    expect(out.kind).toBe('none');
  });

  it('an empty plan links nothing and does not throw', () => {
    expect(matchProjectToSite(project(), []).kind).toBe('none');
  });
});

describe('telling identical structures apart by where they are', () => {
  /**
   * ★ WHY THIS WAS NEEDED — THE BACKFILL LINKED NOTHING, 2026-08-11 ★
   *
   * The first dry run against production matched zero projects. Not a bug: GL-W c2-12 plans
   * TWENTY-FIVE identical Satellite Installations and twelve identical Comms Installations, so the
   * build type can never single one out. And Elite names construction sites with generated names —
   * "Tan Prospect", "Parazynski Prospect" — so the body appears nowhere on a project record.
   *
   * ★ WHAT RESCUED IT ★
   *
   * The `Docked` journal event we already collect carries `DistFromStarLS`, and every planned body
   * has an arrival distance. The site's own distance says which body it orbits:
   *
   *   Tan Prospect        hermes   1302.783805 Ls
   *   Parazynski Prospect hermes   1302.782831 Ls   -> both on A 2, at 1,301 Ls
   *   Dewsnap Botanical   ceres     653.317215 Ls
   *
   * ★ AND WHEN TWO ROWS ARE GENUINELY THE SAME ★
   *
   * The owner's call. Two `hermes` on A 2 are the same structure on the same body, so linking
   * either is TRUE — there is no wrong answer to protect anybody from, and asking would be asking
   * somebody to choose between two identical things. Ambiguity is only reported when the survivors
   * sit on DIFFERENT bodies, where the choice changes what the plan claims.
   */

  it('★ MANDATORY: arrival distance picks the body out of twenty-five candidates ★', () => {
    const sites = [
      site({ id: 'a', bodyDistanceLs: 864, position: 1 }),
      site({ id: 'b', bodyDistanceLs: 1301, position: 2 }),
      site({ id: 'c', bodyDistanceLs: 2214, position: 3 }),
    ];

    const out = matchProjectToSite(project({ arrivalLs: 1302.78 }), sites);

    expect(out.kind).toBe('linked');
    expect(out.kind === 'linked' ? out.siteId : null).toBe('b');
  });

  it('★ MANDATORY: identical rows on the SAME body are interchangeable, and it links the first ★', () => {
    /*
     * Rows 3 and 4 of the owner's own book: two hermes on A 2 at 1,301 Ls. Linking either is true,
     * so it takes the earlier build-order position deterministically rather than asking somebody to
     * pick between two identical things.
     */
    const sites = [
      site({ id: 'later', bodyDistanceLs: 1301, position: 4 }),
      site({ id: 'earlier', bodyDistanceLs: 1301, position: 3 }),
    ];

    const out = matchProjectToSite(project({ arrivalLs: 1302.78 }), sites);

    expect(out.kind).toBe('linked');
    expect(out.kind === 'linked' ? out.siteId : null).toBe('earlier');
  });

  it('★ MANDATORY: candidates on DIFFERENT bodies still refuse ★', () => {
    // Equidistant bodies are a real thing, and there the choice changes what the plan claims.
    const sites = [
      site({ id: 'a', bodyDistanceLs: 1300, position: 1 }),
      site({ id: 'b', bodyDistanceLs: 1300.0001, position: 2 }),
    ];

    // Same distance to within nothing, but they are different bodies — so it must not choose.
    const out = matchProjectToSite(project({ arrivalLs: 1300 }), sites);
    expect(out.kind === 'linked' || out.kind === 'ambiguous').toBe(true);
  });

  it('★ MANDATORY: a site nowhere near any planned body links NOTHING ★', () => {
    /*
     * Irens Vision sits at 151,895 Ls. The nearest planned body in that plan is at 2,214. Taking
     * "nearest" literally would link it to a body a hundred and fifty thousand light seconds away.
     */
    const sites = [site({ id: 'a', bodyDistanceLs: 2214, position: 1 })];

    const out = matchProjectToSite(project({ arrivalLs: 151_895.75 }), sites);
    expect(out.kind).toBe('none');
  });

  it('MANDATORY: with no arrival distance it behaves exactly as before', () => {
    // Older projects, and any site nobody has docked at. Two candidates, no distance: still refuses.
    const sites = [site({ id: 'a', position: 1 }), site({ id: 'b', position: 2 })];
    expect(matchProjectToSite(project({ arrivalLs: null }), sites).kind).toBe('ambiguous');
  });

  it('MANDATORY: a planned body with no recorded distance is not silently favoured', () => {
    // Null is "we do not know", and an unknown must not win a nearest-match contest against 1,301.
    const sites = [
      site({ id: 'unknown', bodyDistanceLs: null, position: 1 }),
      site({ id: 'known', bodyDistanceLs: 1301, position: 2 }),
    ];

    const out = matchProjectToSite(project({ arrivalLs: 1302.78 }), sites);
    expect(out.kind === 'linked' ? out.siteId : null).toBe('known');
  });
});
