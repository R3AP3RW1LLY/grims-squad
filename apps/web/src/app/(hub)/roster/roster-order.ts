/**
 * Where the founders sit on the roster.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "they should always be listed at the top of the all members tab with Mr
 *  Grimsoul in the #1 spot, then after the founders, Pebblemerchant should
 *  always be directly after them on the all members page, and should be the
 *  first person listed on the Members page please!"
 *
 * ★ ONE SORT, AND IT SATISFIES BOTH SENTENCES ★
 *
 * The obvious build is two rules: a pinned block on All members, and a separate
 * special case that lifts Pebblemerchant on the Members tab. Two rules is two
 * places to disagree, and the disagreement would be invisible — each tab looks
 * perfectly plausible on its own.
 *
 * So there is ONE ordering, applied once, and the tabs are filters on the
 * already-ordered list. The Members tab then puts Pebblemerchant first without
 * knowing anything about them: they are the only founding-standing holder who is
 * not an officer, so filtering the officers out of a founders-first list leaves
 * them at the top. The same sort does the officers' tab too, for free.
 *
 * ★ NOTHING HERE KNOWS A NAME ★
 *
 * Not "Grimsoul", not "Pebblemerchant". The order comes from `founder.precedence`,
 * which is `roles.rank_order` on the role they hold — so the owner reorders the
 * pins, renames the titles, or makes somebody else a founder from /app -> Roles,
 * and this file never changes. See `apps/api/src/members/founding.ts`.
 */

import type { FoundingStanding } from '../../../lib/api';

/** The tab key. Named once so the page and its tests cannot drift apart. */
export const FOUNDERS_TAB = 'founders';

/** All this module needs of a member. Keeps the sort testable without a fixture. */
export interface Pinned {
  readonly founder: FoundingStanding | null;
}

/**
 * Founding standing first, in precedence order; everybody else after, untouched.
 *
 * ★ STABLE, AND THAT IS LOAD-BEARING TWICE ★
 *
 * The three co-founders share one role and therefore one precedence, so the only
 * thing deciding their order is the order the API sent them in — which is
 * `joinedAt` ascending, the roster's existing order. An unstable sort would
 * shuffle them between page loads for no reason a reader could see.
 *
 * It matters more for the hundred members with no standing at all: the pinned
 * block is a small change to the top of the roster, not a re-sort of the whole
 * squadron. `Array.prototype.sort` is required to be stable, so the comparator
 * returning 0 is the whole mechanism.
 */
export function foundersFirst<T extends Pinned>(members: readonly T[]): T[] {
  return [...members].sort((a, b) => {
    // Lower precedence is more senior; no standing sorts below all of them.
    const left = a.founder?.precedence ?? Number.MAX_SAFE_INTEGER;
    const right = b.founder?.precedence ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}

/**
 * The Founders tab: the squadron's founders, and nobody else.
 *
 * `foundedSquadron` rather than "has founding standing" — the owner named four
 * people for this tab and placed Pebblemerchant after them, so the hub founder
 * is pinned to the top of the roster and is deliberately not on it. The API
 * decides which is which, from the role key; see `founding.ts`.
 */
export function squadronFounders<T extends Pinned>(members: readonly T[]): T[] {
  return members.filter((m) => m.founder?.foundedSquadron === true);
}
