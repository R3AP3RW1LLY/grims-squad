/**
 * How old the figure is that somebody is about to spend credits against.
 *
 * ★ SQUADRON OWNER, 2026-08-12 ★
 *
 * "someone without the companion app completed a project and it did not update ... this causes
 * confusion and causes our members to go buy materials for a project thats completed and not
 * needed."
 *
 * ★ WHY THIS EXISTS INSTEAD OF A CLEVERER DETECTION ★
 *
 * We chased the detection first, and most of it turned out to be impossible.
 *
 * A finished Satellite Installation, Comms Installation or settlement is NOT DOCKABLE. The
 * construction site somebody was delivering to simply stops existing, so no journal event will ever
 * fire for it again, from anyone — there is nothing left to dock at and nothing left to report.
 * EDDN's journal schema carries seven events and none of them are colonisation. Inara's API has two
 * read endpoints and neither is either. Frontier publishes no station feed at all.
 *
 * So for a build finished by a commander running no tools, there is no signal to find. That is the
 * shape of the game's data, not a gap in our plumbing.
 *
 * This makes NO attempt to detect anything, and that is precisely why it covers the case nothing
 * else can. It states how old the reading is, wherever somebody is about to act on it. A wrong
 * number presented as certain costs a member a wasted trip across the bubble; the same wrong number
 * presented as a fortnight old costs them a question.
 */

export type Freshness = 'fresh' | 'ageing' | 'stale' | 'unknown';

export interface FreshnessVerdict {
  readonly state: Freshness;
  /** Whole days since the reading. Null when there has never been one. */
  readonly days: number | null;
  /** Whether a surface should draw attention to it, rather than merely mention it. */
  readonly warn: boolean;
  /** What to show a member. Never empty — every state has something worth saying. */
  readonly sentence: string;
}

/**
 * Ageing at two days, stale at seven.
 *
 * Two days because a squadron plans an evening at a time and yesterday's figure is still worth
 * acting on. Seven because a week is long enough for a build to have finished entirely without
 * anybody who reports to us having gone near it — which is the case that started this.
 *
 * The gap between them matters: if everything warns, nothing does. `ageing` is mentioned in passing
 * so the loud state keeps its meaning.
 */
const AGEING_DAYS = 2;
const STALE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function needsFreshness(observedAt: Date | null, now: Date): FreshnessVerdict {
  if (observedAt === null) {
    /*
     * Never observed is NOT the same as very old, and saying so matters. A project posted an hour
     * ago that nobody has docked at yet has no reading at all — its figures are the catalogue's
     * estimate. Reporting that as infinitely stale would be alarming and wrong.
     */
    return {
      state: 'unknown',
      days: null,
      warn: true,
      sentence:
        'Nobody has docked here yet, so these are catalogue estimates rather than what the site ' +
        'has actually asked for.',
    };
  }

  // Clock skew between a member's machine and ours must never produce "-1 days ago".
  const elapsed = Math.max(0, now.getTime() - observedAt.getTime());
  const days = Math.floor(elapsed / DAY_MS);

  if (days >= STALE_DAYS) {
    return {
      state: 'stale',
      days,
      warn: true,
      /*
       * "May already be built" rather than "out of date". The second tells a member nothing they can
       * do; the first is the sentence that makes somebody check before spending, which is the whole
       * purpose of this module.
       */
      sentence:
        `Last confirmed ${days} days ago. This build may already be complete — check before ` +
        'buying for it.',
    };
  }

  if (days >= AGEING_DAYS) {
    return {
      state: 'ageing',
      days,
      warn: false,
      sentence: `Last confirmed ${days} days ago.`,
    };
  }

  return {
    state: 'fresh',
    days,
    warn: false,
    sentence: days === 0 ? 'Confirmed today.' : 'Confirmed yesterday.',
  };
}
