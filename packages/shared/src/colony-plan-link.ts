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
 * `colony_plan_sites.project_id` exists and carries the comment "Set once this intention became a
 * real construction site, so a plan can show its own progress". Nothing has ever written it — 0 of
 * 81 sites were linked in production — so the progress model that reads it has always reported
 * every site as merely planned, however much had actually been hauled.
 *
 * ★ WHY THE MATCH IS SYSTEM + BUILD TYPE, AND NOT BODY ★
 *
 * A project does not know which body it sits on. It has a market id, a system, a station name and a
 * bill of materials; the body is simply not on the record. What it does have is the catalogue row
 * its requirement FINGERPRINTS to — twenty-odd commodities at exact tonnages, and no two build
 * types share one — so "this is an Ocellus Starport in this system" is known with certainty even
 * though "which of the six planned Refinery Hubs" is not.
 *
 * ★ AND WHY IT REFUSES RATHER THAN GUESSES ★
 *
 * The owner's choice: automatic when unambiguous, ask when not. GL-W c2-12 plans six Refinery Hubs.
 * Picking the first would mark the wrong body built on the page a squadron uses to decide what to
 * fly tonight, and nobody would notice until they flew there. Being asked is a two-second tap.
 */

export interface LinkCandidateSite {
  readonly id: string;
  /** The catalogue row this site intends. Null when nobody has chosen a build for it yet. */
  readonly buildTypeId: string | null;
  /** Already spoken for, by this project or another. */
  readonly projectId: string | null;
}

export interface LinkableProject {
  readonly id: string;
  /**
   * The catalogue row the site's REQUIREMENT fingerprints to — never the free text somebody typed.
   * Null until a commander has docked there and the bill of materials is known.
   */
  readonly buildTypeId: string | null;
}

export type LinkOutcome =
  | { readonly kind: 'linked'; readonly siteId: string }
  | { readonly kind: 'ambiguous'; readonly siteIds: readonly string[] }
  | { readonly kind: 'none'; readonly why: string };

/**
 * The planned site this project fulfils, if that can be known without guessing.
 *
 * `sites` must already be narrowed to the plan covering the project's system — which system a plan
 * is for is a database join, not a judgement, and doing it here would mean passing every plan in
 * the squadron to a pure function.
 */
export function matchProjectToSite(
  project: LinkableProject,
  sites: readonly LinkCandidateSite[],
): LinkOutcome {
  /*
   * Idempotence first. The backfill runs dry, then live, then again by whoever is checking; a
   * second pass must find the link it already made rather than reporting a conflict with itself.
   */
  const already = sites.find((s) => s.projectId === project.id);
  if (already !== undefined) return { kind: 'linked', siteId: already.id };

  if (project.buildTypeId === null) {
    return {
      kind: 'none',
      why:
        'Nobody has docked at this site yet, so what it is being built as cannot be identified. ' +
        'It links itself once the first commander reports its requirements.',
    };
  }

  const candidates = sites.filter(
    (s) => s.projectId === null && s.buildTypeId === project.buildTypeId,
  );

  if (candidates.length === 0) {
    return {
      kind: 'none',
      why: 'Nothing in the plan intends this structure, or every one of them is already under way.',
    };
  }

  if (candidates.length > 1) {
    return { kind: 'ambiguous', siteIds: candidates.map((s) => s.id) };
  }

  // Non-null: length is exactly 1.
  return { kind: 'linked', siteId: candidates[0]!.id };
}
