import type { AdminActivityRow } from '../../../lib/api';
import { lastSeen } from './activity-freshness';
import { squadronTenure } from './member-tenure';

/**
 * Filtering the activity roster, one column at a time.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "we need to make these pages columns filterable please!"
 *
 * A hundred and seventeen rows and eleven columns. Every question an officer opens this page with is
 * a filter — who is due a promotion, who has gone quiet, who never verified a commander, who is
 * still a Cadet after six months — and answering any of them by scrolling is how a roster stops
 * being read at all.
 *
 * ★ WHY THIS IS NOT IN THE COMPONENT ★
 *
 * The rules are the interesting part and they are all edge cases: what "any" means, whether a blank
 * number is zero or no-filter, whether "quiet" includes somebody sitting in voice. Kept pure and
 * separate, they can be tested without rendering a table; kept inside a `.map` they could not be
 * tested at all.
 */

export interface ActivityFilter {
  /** Free text across every name a member is known by, including their commander name. */
  readonly member: string;
  /** '' any · 'joined' has a hub account · 'discord' Discord only */
  readonly hub: '' | 'joined' | 'discord';
  /** '' any · 'yes' verified commander · 'no' not verified */
  readonly verified: '' | 'yes' | 'no';
  /** Exact rank label as displayed, including the membership fallback. '' is any. */
  readonly rank: string;
  /** Exact `gameActivity` key. '' is any. */
  readonly game: string;
  /** '' any · 'yes' · 'no' · 'na' at the top of the ladder */
  readonly qualifies: '' | 'yes' | 'no' | 'na';
  /** '' any · 'live' in voice now · 'quiet' past the threshold · 'active' everything else */
  readonly seen: '' | 'live' | 'quiet' | 'active';
  /** '' any · buckets · 'unknown' no tenure at all */
  readonly tenure: '' | 'under1m' | '1to6m' | '6to12m' | 'over1y' | 'unknown';
  /**
   * Lower bounds on the three counters. Null is NO FILTER; zero is a real filter that happens to
   * match everybody.
   *
   * They are different, and conflating them is the obvious bug: typing 0 and then deleting it would
   * leave the box empty and the filter still applied, or leave it showing 0 and filtering nothing.
   */
  readonly minMessages: number | null;
  readonly minForum: number | null;
  readonly minVoice: number | null;
}

export const EMPTY_FILTER: ActivityFilter = {
  member: '',
  hub: '',
  verified: '',
  rank: '',
  game: '',
  qualifies: '',
  seen: '',
  tenure: '',
  minMessages: null,
  minForum: null,
  minVoice: null,
};

/** Is any filter actually doing something? Drives whether "Clear" is offered. */
export function isFiltering(f: ActivityFilter): boolean {
  return (
    f.member.trim() !== '' ||
    f.hub !== '' ||
    f.verified !== '' ||
    f.rank !== '' ||
    f.game !== '' ||
    f.qualifies !== '' ||
    f.seen !== '' ||
    f.tenure !== '' ||
    f.minMessages !== null ||
    f.minForum !== null ||
    f.minVoice !== null
  );
}

/**
 * The rank as the table shows it.
 *
 * The Rank column falls back through tenure rank, membership role, then "Unranked". The filter has
 * to use the same chain or the dropdown would offer values that match nothing — picking "Cadet"
 * from a list and getting an empty table is worse than having no filter.
 */
export function rankLabel(r: AdminActivityRow): string {
  return r.currentRank ?? r.membershipRole ?? 'Unranked';
}

/** Which tenure bucket a row falls in. `unknown` when there is no date at all. */
export function tenureBucket(r: AdminActivityRow, now: number): ActivityFilter['tenure'] {
  const t = squadronTenure(r, now);
  if (t === null) return 'unknown';
  if (t.totalDays < 30) return 'under1m';
  if (t.totalDays < 183) return '1to6m';
  if (t.totalDays < 365) return '6to12m';
  return 'over1y';
}

/** Every name this member could be searched by. */
function names(r: AdminActivityRow): string {
  /*
   * The discord id is included deliberately. It is what an officer has in hand when they copy
   * somebody out of Discord's own UI, and it is the one identifier that is never ambiguous.
   */
  return [r.nick, r.displayName, r.handle, r.cmdrName, r.discordId]
    .filter((v): v is string => v !== null)
    .join(' ')
    .toLowerCase();
}

/** Does this row survive the filter? All fields AND together. */
export function matchesFilter(
  r: AdminActivityRow,
  f: ActivityFilter,
  now: number = Date.now(),
): boolean {
  const term = f.member.trim().toLowerCase();
  if (term !== '' && !names(r).includes(term)) return false;

  if (f.hub === 'joined' && !r.joinedWebsite) return false;
  if (f.hub === 'discord' && r.joinedWebsite) return false;

  if (f.verified === 'yes' && r.cmdrName === null) return false;
  if (f.verified === 'no' && r.cmdrName !== null) return false;

  if (f.rank !== '' && rankLabel(r) !== f.rank) return false;
  if (f.game !== '' && r.gameActivity !== f.game) return false;

  if (f.qualifies !== '') {
    /*
     * Three states, matching the column. `n/a` is somebody at the top of the ladder: `qualifies` is
     * false for them by design, so a plain yes/no filter would file a Grand Master General under
     * "not qualifying" alongside members who have done nothing — which is the opposite of the truth.
     */
    const state = r.qualifies ? 'yes' : r.nextRank === null && r.currentRank !== null ? 'na' : 'no';
    if (state !== f.qualifies) return false;
  }

  if (f.seen !== '') {
    const tone = lastSeen(r, now).tone;
    const state = tone === 'live' ? 'live' : tone === 'quiet' ? 'quiet' : 'active';
    if (state !== f.seen) return false;
  }

  if (f.tenure !== '' && tenureBucket(r, now) !== f.tenure) return false;

  if (f.minMessages !== null && r.messageCount < f.minMessages) return false;
  if (f.minForum !== null && r.forumPostCount < f.minForum) return false;
  if (f.minVoice !== null && r.voiceJoinCount < f.minVoice) return false;

  return true;
}

/**
 * The distinct values for a dropdown, in the order the rows give them, sorted.
 *
 * Built from the DATA rather than from a fixed list: a rank role added in Discord next month appears
 * in the filter automatically, and a rank nobody holds does not clutter it. A hard-coded list would
 * be a second copy of the ladder, free to drift from the one the rows carry.
 */
export function distinct(rows: readonly AdminActivityRow[], of: (r: AdminActivityRow) => string): string[] {
  return [...new Set(rows.map(of))].filter((v) => v !== '').sort((a, b) => a.localeCompare(b));
}
