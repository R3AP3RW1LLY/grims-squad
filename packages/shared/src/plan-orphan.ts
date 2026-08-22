/**
 * A plan that has stopped meaning what it looks like it means.
 *
 * ★ SQUADRON OWNER, 2026-08-22 ★
 *
 * Asked which of three things "orphan" meant, the answer was all three, ranked — so they are three
 * separate findings with three separate sentences, not one badge saying "orphan".
 *
 * That distinction is the whole feature. An officer looking at a list needs to tell a plan somebody
 * FORGOT from a plan that is BROKEN: the first wants a decision, the second wants a fix, and a
 * single label would send them to the wrong one.
 *
 * ★ FLAGGED, NEVER CORRECTED ★
 *
 * Every condition below is reported and nothing is changed. A plan is somebody's intention, and the
 * three states here are all recoverable — a forgotten plan may be next month's project, and a plan
 * pointing at deleted projects still records what somebody meant to build. The platform auto-
 * corrects exactly one thing (a plan row describing a structure nobody built) and that is because
 * the game itself supplies the correct answer. Nothing here has that.
 */

export interface OrphanPlanFacts {
  readonly planId: string;
  readonly title: string;
  readonly systemName: string;
  /** The newest of created/updated. Null when neither is known. */
  readonly touchedAt: Date | null;
  readonly siteCount: number;
  /** Sites whose `project_id` names a project that no longer exists. */
  readonly danglingSites: number;
  /** Projects in this system that are neither completed nor abandoned. */
  readonly liveProjects: number;
  /** Whether this system has ever had a project at all. */
  readonly everBuilt: boolean;
}

export type OrphanKind = 'dangling-sites' | 'nothing-live' | 'stale';

export interface OrphanFlag {
  readonly kind: OrphanKind;
  /** Lower sorts first. A broken plan outranks a forgotten one. */
  readonly rank: number;
  /** What to show an officer. Complete sentences — this is read in a list, not a tooltip. */
  readonly message: string;
}

/**
 * How long before a plan nobody has touched is worth mentioning.
 *
 * 90 days. A colonisation plan is a months-long undertaking, so a fortnight of quiet means nothing
 * and even a month is ordinary — somebody banking credits or waiting on a carrier. A quarter is
 * long enough that "did we abandon this?" is a fair question rather than a nag.
 */
export const PLAN_STALE_DAYS = 90;

/**
 * What is wrong with this plan, worst first.
 *
 * ★ THE RANKING IS THE ANSWER TO "ALL THREE" ★
 *
 * `dangling-sites` first, because it is the only one that is a FAULT: the plan is showing progress
 * against projects that no longer exist, so its numbers are wrong right now and an officer reading
 * them is being misled.
 *
 * `nothing-live` second. Nothing is broken — the plan is simply not being acted on, which is worth
 * knowing before somebody schedules a haul against it.
 *
 * `stale` last, and only when neither of the others applies. A plan with dangling sites is also old,
 * and saying both would bury the fault under the observation. One finding per plan, and it is the
 * most actionable one.
 */
/** Whole days since a plan was last touched, or null when nothing dated it. */
function ageDays(touchedAt: Date | null, now: Date): number | null {
  if (touchedAt === null) return null;
  const days = Math.floor((now.getTime() - touchedAt.getTime()) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

export function orphanFlags(facts: OrphanPlanFacts, now: Date): readonly OrphanFlag[] {
  const flags: OrphanFlag[] = [];

  if (facts.danglingSites > 0) {
    const n = facts.danglingSites;
    flags.push({
      kind: 'dangling-sites',
      rank: 0,
      message:
        `${n} site${n === 1 ? '' : 's'} in this plan point at a construction project that no longer ` +
        `exists, so its progress is measured against something that is gone.`,
    });
  }

  /*
   * A plan with no sites is not an orphan — it is a plan somebody started five minutes ago. Judging
   * it would put a warning on the first thing a new member ever does.
   */
  if (facts.siteCount > 0 && facts.liveProjects === 0) {
    const age = ageDays(facts.touchedAt, now);
    /*
     * ★ AGE IS A MODIFIER ON DORMANCY, NOT A THIRD STATE ★
     *
     * The three conditions the owner named collapse to two on the facts available. "Nobody has
     * touched it" and "nothing is being built to it" are not independent: a plan being actively
     * hauled to is not forgotten however long ago it was last EDITED, so staleness has to require
     * that nothing is live — and that is exactly the condition for this flag.
     *
     * Written as one finding whose sentence lengthens rather than two flags where the second could
     * never fire. A rule that cannot fire is worse than no rule: it reads as coverage.
     */
    const dormant =
      age !== null && age >= PLAN_STALE_DAYS ? ` Nobody has touched it in ${age} days either.` : '';

    flags.push({
      kind: 'nothing-live',
      rank: 1,
      message:
        (facts.everBuilt
          ? 'Every construction project in this system is finished or abandoned, so nothing here is ' +
            'being built to this plan any more.'
          : 'Nothing has ever been posted in this system, so this plan has not been started.') +
        dormant,
    });
  }

  /*
   * ★ STALE, FOR A PLAN THAT IS OTHERWISE FINE ★
   *
   * Reached only when nothing above fired — so the plan has live projects and no broken rows, and
   * the only thing odd about it is that the layout itself has not been revisited in a long time.
   *
   * That is a real and different thing from dormancy: a build somebody is hauling to against a plan
   * nobody has looked at since the site list was written. Worth a quiet mention and nothing louder,
   * which is why it is ranked last and phrased as an observation.
   */
  const age = ageDays(facts.touchedAt, now);
  if (age !== null && age >= PLAN_STALE_DAYS && facts.siteCount > 0 && flags.length === 0) {
    flags.push({
      kind: 'stale',
      rank: 2,
      message:
        `Nobody has revisited this plan in ${age} days, though the system is still being built.`,
    });
  }

  return flags.sort((a, b) => a.rank - b.rank);
}
