import { hasPermission, Permission, type PermissionMask } from './permissions.js';

/**
 * In progress, complete, or abandoned.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "we also need to allow admins to mark builds as abandoned and not always just as complete.
 * abandond projects should be hidden to all other members except the project owner please. and
 * should appear red."
 *
 * ★ WHY A THIRD STATE AND NOT JUST CLOSING IT ★
 *
 * Until now a project was complete or it was not, and nothing else. A build the squadron gave up on
 * therefore had two possible endings and both were false: leave it open and it sits on the board
 * for ever asking for materials nobody will ever haul, or mark it complete and a station that was
 * never finished enters the record the squadron measures itself by.
 *
 * People choose the second, because closing it is the only button there is.
 *
 * ★ AND WHY IT IS HIDDEN ★
 *
 * The same complaint that produced the completion safeguard — "causes our members to go buy
 * materials for a project thats completed". An abandoned build left on the board costs somebody a
 * cargo hold of Titanium and a trip.
 */

export type ColonyStatus = 'in-progress' | 'complete' | 'abandoned';

export interface ColonyStatusRow {
  readonly completedAt: Date | null;
  readonly abandonedAt: Date | null;
}

/**
 * ★ ABANDONED IS READ FIRST, DELIBERATELY ★
 *
 * Both columns can be set. The ordinary way it happens: a project was marked complete, and an
 * officer who knows it never was marks it abandoned afterwards. Reading `completedAt` first would
 * report the state the officer acted to correct.
 */
export function colonyStatusOf(row: ColonyStatusRow): ColonyStatus {
  if (row.abandonedAt !== null) return 'abandoned';
  if (row.completedAt !== null) return 'complete';
  return 'in-progress';
}

export interface AbandonedViewer {
  readonly viewerId: string | null;
  readonly postedById: string;
  readonly mask: PermissionMask;
}

/**
 * Whether this reader may see an abandoned build at all.
 *
 * Two people, and the owner named both: the member who posted it, and officers.
 *
 * The poster, because it is their build and hiding somebody's own project from them is
 * indistinguishable from the platform having deleted it. Officers, because a state only its author
 * can see is a state nobody can audit — including the officer who set it, who would be unable to
 * find it again to undo it.
 */
export function maySeeAbandoned(viewer: AbandonedViewer): boolean {
  if (viewer.viewerId === null) return false;
  if (viewer.viewerId === viewer.postedById) return true;
  return hasPermission(viewer.mask, Permission.COLONY_MANAGE);
}

export const COLONY_STATUS_FILTERS = ['in-progress', 'complete', 'abandoned', 'all'] as const;

export type ColonyStatusFilter = (typeof COLONY_STATUS_FILTERS)[number];

/**
 * What the board shows when nobody has chosen.
 *
 * The filters exist because the board fills up with finished builds. Defaulting to `all` would
 * leave the page exactly as it is today, and make the filter something every member has to set on
 * every visit to get the view they actually wanted.
 */
export const DEFAULT_COLONY_FILTER: ColonyStatusFilter = 'in-progress';

/**
 * Whether a project belongs in the chosen view.
 *
 * ★ THIS IS NOT A PERMISSION CHECK ★
 *
 * It answers what the reader ASKED to see. `maySeeAbandoned` answers what they MAY see. Merging the
 * two is how one of them silently stops being applied — so `all` here really does mean all, and the
 * ACL is what keeps other members' abandoned builds out of it.
 */
export function matchesColonyFilter(row: ColonyStatusRow, filter: ColonyStatusFilter): boolean {
  if (filter === 'all') return true;
  return colonyStatusOf(row) === filter;
}
