/**
 * How much of a plan has actually been built.
 *
 * ★ SQUADRON OWNER, 2026-08-11 ★
 *
 * "on the build order page, can we track what has been built please? and can we track the remaining
 * To haul or add in the To haul card the remaining | whats been hauled"
 *
 * ★ ANSWERABLE ONLY SINCE A PLANNED SITE CAN POINT AT ITS PROJECT ★
 *
 * `colony_plan_sites.project_id` sat unwritten for as long as the planner existed. With it, the two
 * halves finally meet: the plan knows what a build WOULD cost from the catalogue, and the project
 * knows what it actually still wants, because a commander docked there and their journal said so.
 *
 * ★ THREE STATES, NOT TWO ★
 *
 * The owner's choice, and the right one. A project posted an hour ago with nothing delivered is not
 * built, and counting it as built would overstate the very number somebody steers by. So: PLANNED
 * (no project), BUILDING (posted, hauling), COMPLETE (nothing outstanding).
 *
 * ★ AND THE TOTALS SAY WHICH HALF THEY MEASURED ★
 *
 * A plan of eighty-one sites with three posted has three MEASURED tonnages and seventy-eight
 * catalogue ESTIMATES. Blending them into one confident "13% hauled" would present a guess as a
 * fact — on the figure a squadron plans a fortnight around. The split is carried out of here so the
 * page can say it.
 */

export type SiteState = 'planned' | 'building' | 'complete';

/** A planned site, as this arithmetic needs to see it. */
export interface ProgressSite {
  readonly id: string;
  /** What the catalogue says this build costs. Null when no build has been chosen yet. */
  readonly totalTonnes: number | null;
  /** The project this site became, if somebody has placed and posted it. */
  readonly project: {
    /** Tonnes the site itself has reported wanting. Zero before anybody has docked there. */
    readonly required: number;
    readonly remaining: number;
    readonly completedAt: Date | null;
  } | null;
}

export interface SiteProgress {
  readonly id: string;
  readonly state: SiteState;
  /** Tonnes delivered. Null when nothing measurable is known — a planned site has no deliveries. */
  readonly hauled: number | null;
  /** Tonnes still wanted: measured where a project reports, else the catalogue's figure. */
  readonly remaining: number;
  /** The figure this row counts toward the total, measured or estimated. */
  readonly total: number;
  /** True when these numbers come from a real site rather than the catalogue. */
  readonly measured: boolean;
}

export interface PlanProgress {
  readonly sites: readonly SiteProgress[];
  readonly totalTonnes: number;
  readonly hauledTonnes: number;
  readonly remainingTonnes: number;
  /** 0–100, or null when the plan has no tonnage at all to be a share of. */
  readonly pctHauled: number | null;
  readonly measuredSites: number;
  readonly estimatedSites: number;
  readonly complete: number;
  readonly building: number;
  readonly planned: number;
}

/**
 * One site's state and figures.
 *
 * ★ A POSTED PROJECT THAT HAS NEVER BEEN DOCKED AT REPORTS NOTHING ★
 *
 * `required` is zero until a commander's journal reports the site's bill of materials, which is a
 * different thing from a site that wants nothing. Falling back to the catalogue there keeps the
 * plan's total stable instead of collapsing the moment somebody posts a project.
 */
export function siteProgress(site: ProgressSite): SiteProgress {
  const estimate = site.totalTonnes ?? 0;

  if (site.project === null) {
    return { id: site.id, state: 'planned', hauled: null, remaining: estimate, total: estimate, measured: false };
  }

  const { required, remaining, completedAt } = site.project;

  // Posted, but the site has never reported its needs. The catalogue is still the best figure.
  if (required <= 0) {
    return {
      id: site.id,
      state: completedAt === null ? 'building' : 'complete',
      hauled: completedAt === null ? 0 : estimate,
      remaining: completedAt === null ? estimate : 0,
      total: estimate,
      measured: false,
    };
  }

  const hauled = Math.max(0, required - remaining);
  const done = completedAt !== null || remaining <= 0;

  return {
    id: site.id,
    state: done ? 'complete' : 'building',
    hauled,
    remaining: done ? 0 : remaining,
    total: required,
    measured: true,
  };
}

/** The whole plan, rolled up. */
export function planProgress(sites: readonly ProgressSite[]): PlanProgress {
  const rows = sites.map(siteProgress);

  const totalTonnes = rows.reduce((n, r) => n + r.total, 0);
  const hauledTonnes = rows.reduce((n, r) => n + (r.hauled ?? 0), 0);
  const remainingTonnes = rows.reduce((n, r) => n + r.remaining, 0);

  return {
    sites: rows,
    totalTonnes,
    hauledTonnes,
    remainingTonnes,
    // Null rather than zero: a plan with nothing in it is not "0% hauled", it is not a plan yet.
    pctHauled: totalTonnes > 0 ? Math.round((hauledTonnes / totalTonnes) * 100) : null,
    measuredSites: rows.filter((r) => r.measured).length,
    estimatedSites: rows.filter((r) => !r.measured).length,
    complete: rows.filter((r) => r.state === 'complete').length,
    building: rows.filter((r) => r.state === 'building').length,
    planned: rows.filter((r) => r.state === 'planned').length,
  };
}
