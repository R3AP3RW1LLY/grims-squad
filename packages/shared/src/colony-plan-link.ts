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
  /**
   * How far the planned BODY is from the system's arrival point, in light seconds. Null until
   * somebody has surveyed it — and null must never win a nearest-match contest against a number.
   */
  readonly bodyDistanceLs?: number | null;
  /** Build-order position, used only to break a tie between rows that are genuinely identical. */
  readonly position?: number;
}

export interface LinkableProject {
  readonly id: string;
  /**
   * The catalogue row the site's REQUIREMENT fingerprints to — never the free text somebody typed.
   * Null until a commander has docked there and the bill of materials is known.
   */
  readonly buildTypeId: string | null;
  /**
   * The construction site's own distance from the arrival star, from the `Docked` journal event.
   *
   * ★ WHAT RESCUED THE BACKFILL — 2026-08-11 ★
   *
   * The first dry run linked nothing: GL-W c2-12 plans twenty-five identical Satellite
   * Installations, and Elite names construction sites with generated names, so neither the build
   * type nor the name can single one out. This can — a site at 1,302.78 Ls is orbiting the body
   * planned at 1,301, and no other.
   */
  readonly arrivalLs?: number | null;
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

  /*
   * The sanity check runs whatever the count. A plan with exactly ONE unlinked `pistis` and a
   * project 151,895 Ls away would otherwise link them for want of an alternative — which is how a
   * plan claims a build is under way in a place nobody has been.
   */
  const narrowed = nearestBody(candidates, project.arrivalLs ?? null);

  if (narrowed === 'nowhere-near') {
    return {
      kind: 'none',
      why:
        'This site is nowhere near any body the plan intends. Taking the nearest anyway would ' +
        'link it to somewhere it plainly is not.',
    };
  }

  if (candidates.length > 1) {
    if (narrowed !== null) {
      /*
       * ★ IDENTICAL ROWS ARE INTERCHANGEABLE — SQUADRON OWNER, 2026-08-11 ★
       *
       * Two `hermes` on A 2 are the same structure on the same body, so linking either is TRUE.
       * There is no wrong answer to protect anybody from, and asking would be asking somebody to
       * choose between two identical things. The earliest build-order position wins, so the choice
       * is deterministic and a re-run reaches the same answer.
       */
      const first = [...narrowed].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
      if (first !== undefined) return { kind: 'linked', siteId: first.id };
    }

    return { kind: 'ambiguous', siteIds: candidates.map((s) => s.id) };
  }

  const only = candidates[0];
  if (only === undefined) {
    // Unreachable: length is exactly 1 here. Written as a check rather than an assertion because
    // the compiler cannot see that, and a wrong link is the failure this whole file exists to avoid.
    return { kind: 'none', why: 'No planned site fitted.' };
  }
  return { kind: 'linked', siteId: only.id };
}

/**
 * The candidates orbiting the body this site actually sits at, or null when that cannot be told.
 *
 * Returns `'nowhere-near'` when the closest planned body is implausibly far — Irens Vision sits at
 * 151,895 Ls and the nearest body in its plan is at 2,214, and taking "nearest" literally there
 * would link it to somewhere it plainly is not.
 */
function nearestBody(
  candidates: readonly LinkCandidateSite[],
  arrivalLs: number | null,
): readonly LinkCandidateSite[] | 'nowhere-near' | null {
  if (arrivalLs === null) return null;

  // Null distance is "we have not surveyed it", which must not beat a real number.
  const placed = candidates.filter(
    (c): c is LinkCandidateSite & { bodyDistanceLs: number } =>
      typeof c.bodyDistanceLs === 'number',
  );
  if (placed.length === 0) return null;

  const gap = (c: { bodyDistanceLs: number }): number => Math.abs(c.bodyDistanceLs - arrivalLs);
  const best = Math.min(...placed.map(gap));

  /*
   * A station orbits its body a short way out, so a few light seconds of slack is expected and
   * anything beyond a wide margin is a different place entirely. Proportional rather than fixed:
   * 5 Ls of slop is generous at 800 Ls and meaningless at 150,000.
   */
  if (best > Math.max(50, arrivalLs * 0.05)) return 'nowhere-near';

  // Same body, not merely a similar distance: two bodies can sit at the same range from the star.
  const winner = placed.find((c) => gap(c) === best);
  if (winner === undefined) return null;

  return placed.filter((c) => c.bodyDistanceLs === winner.bodyDistanceLs);
}
