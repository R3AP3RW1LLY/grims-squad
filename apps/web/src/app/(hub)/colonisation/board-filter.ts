import {
  COLONY_STATUS_FILTERS,
  DEFAULT_COLONY_FILTER,
  colonyStatusOf,
  matchesColonyFilter,
  type ColonyStatusFilter,
} from '@grims/shared/colony-status';
import type { BoardSort } from './board-order';

/**
 * The board's status filter, and the one place a board link is built.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "on the Members' and Squadron pages on both web and companion app, we need to add view filters
 * one for inprogress and one for complete"
 *
 * ★ WHY THE HREF IS BUILT HERE AND NOT IN EACH CONTROL ★
 *
 * `board-sort-links.tsx` builds every link as `${basePath}?sort=${key}`. Correct while sort is the
 * only control on the page, and silently wrong the moment there are two: picking a sort would drop
 * the filter, picking a filter would drop the sort, and each would look like it randomly reset the
 * other.
 *
 * `page-tabs.tsx` already documents the same class of bug from the other side — appending `?` to a
 * basePath that carries a query gives `?a=1?tab=b`, which parses as one parameter and leaves the
 * control never matching its own link.
 *
 * So both controls call `boardHref`, and neither knows what the other's state is called.
 *
 * ★ THE STATUSES THEMSELVES COME FROM @grims/shared ★
 *
 * Imported by SUBPATH, not the barrel: the barrel reaches `node:crypto` and this module is pulled
 * into a client bundle. The rule for what counts as in-progress lives there because the companion
 * app applies the identical rule — two implementations is how the app and the site start
 * disagreeing about what a member is looking at.
 */

const LABELS: Record<ColonyStatusFilter, string> = {
  'in-progress': 'In progress',
  complete: 'Complete',
  abandoned: 'Abandoned',
  all: 'All',
};

export const BOARD_FILTERS = COLONY_STATUS_FILTERS.map((key) => ({ key, label: LABELS[key] }));

/**
 * ★ FALLS BACK RATHER THAN SHOWING NOTHING ★
 *
 * A stale link, a typo, or a member editing the URL. An unrecognised value matching no project
 * would render an empty board, which reads as the squadron having stopped building rather than as
 * a bad parameter.
 */
export function resolveFilter(raw: string | undefined): ColonyStatusFilter {
  return COLONY_STATUS_FILTERS.some((f) => f === raw)
    ? (raw as ColonyStatusFilter)
    : DEFAULT_COLONY_FILTER;
}

/**
 * Which filters to actually offer this reader.
 *
 * An abandoned build is visible only to its poster and to officers. A tab that is permanently empty
 * for most of the squadron is not a harmless extra — it teaches people that the controls on this
 * page do not work, which costs more than the tab is worth.
 */
export function visibleFilters(viewer: {
  canManage: boolean;
  hasAbandoned: boolean;
}): ReadonlyArray<{ key: ColonyStatusFilter; label: string }> {
  return BOARD_FILTERS.filter(
    (f) => f.key !== 'abandoned' || viewer.canManage || viewer.hasAbandoned,
  );
}

/** A project as the board filter needs to see it. */
interface FilterableProject {
  readonly completedAt: string | null;
  readonly abandonedAt?: string | null | undefined;
}

export interface FilteredBoard<T> {
  readonly projects: readonly T[];
  /** How many builds each filter would show. The tabs carry these. */
  readonly counts: Readonly<Record<ColonyStatusFilter, number>>;
  /** Whether this reader has an abandoned build to look at, which decides if the tab is offered. */
  readonly hasAbandoned: boolean;
}

/** The JSON board sends timestamps as strings; the shared rule works in Dates. */
const asDate = (raw: string | null | undefined): Date | null => {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
};

/**
 * Splits a ranked board into the view the member asked for, and counts the rest.
 *
 * ★ COUNTS COME FROM THE WHOLE BOARD, NOT THE VIEW ★
 *
 * The tabs say how many builds each filter would show, which is only useful if it is computed
 * before the filter is applied — otherwise every tab reports the size of the tab already open.
 *
 * ★ AND IT NEVER HIDES ANYTHING THE SERVER SENT ★
 *
 * An abandoned project only reaches this code if the caller is allowed to see it: the API decides
 * that, in the ACL and again in the board's own SQL. Re-deciding it here would be a second answer
 * to a question already answered, and the one that drifted would be the one drawing the page.
 */
export function filterBoard<T extends FilterableProject>(
  projects: readonly T[],
  filter: ColonyStatusFilter,
  canManage: boolean,
): FilteredBoard<T> {
  const counts: Record<ColonyStatusFilter, number> = {
    'in-progress': 0,
    complete: 0,
    abandoned: 0,
    all: projects.length,
  };

  for (const p of projects) {
    const row = { completedAt: asDate(p.completedAt), abandonedAt: asDate(p.abandonedAt) };
    counts[colonyStatusOf(row)] += 1;
  }

  return {
    projects: projects.filter((p) =>
      matchesColonyFilter(
        { completedAt: asDate(p.completedAt), abandonedAt: asDate(p.abandonedAt) },
        filter,
      ),
    ),
    counts,
    // An officer always gets the tab; anybody else only when they have one of their own, which is
    // the only way an abandoned build reaches them at all.
    hasAbandoned: canManage || counts.abandoned > 0,
  };
}

/**
 * A board URL carrying every control's state.
 *
 * Defaults are omitted deliberately. The board's canonical address is the one a member sends a
 * squadmate, and `?sort=best&filter=in-progress` on every link would make the ordinary view look
 * like a deliberately narrowed one.
 */
export function boardHref(state: {
  basePath: string;
  sort: BoardSort;
  filter: ColonyStatusFilter;
  /** Anything else the page carries. Present so the next control added here cannot repeat the bug. */
  extra?: string | undefined;
}): string {
  const params = new URLSearchParams();
  if (state.sort !== 'best') params.set('sort', state.sort);
  if (state.filter !== DEFAULT_COLONY_FILTER) params.set('filter', state.filter);
  if (state.extra !== undefined && state.extra !== '') params.set('extra', state.extra);

  const query = params.toString();
  return query === '' ? state.basePath : `${state.basePath}?${query}`;
}
