/**
 * How often to ask Frontier for a commander's journal.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "can we increase the journal polling for active?"
 *
 * Yes, and this is how — but two ceilings sit above that choice and only one is ours.
 *
 * ★ THE RATE LIMIT IS SHARED, AND SCALES WITH MEMBERSHIP ★
 *
 * Polling is per member; Frontier's limit is per CLIENT ID, across everybody at once. Twenty linked
 * members at five minutes is about 240 requests an hour; at sixty seconds it is about 1,200.
 * Whatever interval is chosen is multiplied by however many people link, so a number that looks
 * harmless at launch is the number that throttles the whole squadron at fifty members.
 *
 * ★ AND FRONTIER REWRITES THE FILE ON THEIR SCHEDULE, NOT OURS ★
 *
 * Asking every thirty seconds for a file regenerated every few minutes spends the shared limit to
 * receive bytes we already hold. Their cadence is not documented anywhere worth trusting, so it is
 * not guessed at here — it is MEASURED. Every poll reports whether the content changed and the
 * interval walks toward whatever that turns out to be, separately for each member.
 *
 * That is the point: a number nobody had to know in advance, which stays correct if Frontier
 * changes theirs, and which costs nothing on the members who are not playing.
 */

/** Where an active commander starts, before anything has been learned about them. */
export const START_MS = 120_000;

/** The fastest we will ever ask. Below this, one keen member spends the squadron's rate limit. */
export const ACTIVE_FLOOR_MS = 60_000;

/** Nobody has flown for an hour. Two requests an hour keeps them current enough to notice a return. */
export const IDLE_MS = 30 * 60_000;

/** Stopped recently — possibly docked, possibly gone. Worth checking, not worth checking often. */
const MIDDLE_MS = 5 * 60_000;

/** Journal growth within this window means they are flying now. */
const ACTIVE_WINDOW_MS = 15 * 60_000;

/** Beyond this, treat them as gone until something says otherwise. */
const IDLE_AFTER_MS = 60 * 60_000;

/**
 * Unchanged polls tolerated before widening.
 *
 * Three, not one. A single unchanged poll is ordinary — a commander in supercruise writes nothing
 * for a minute — and widening on it would oscillate between two intervals for ever, which is both
 * wasteful and impossible to reason about from a log.
 */
const PATIENCE = 3;

export interface PollState {
  /** How long to wait before the next request, in milliseconds. */
  readonly intervalMs: number;
  /** Consecutive polls that returned nothing new. Reset by any change. */
  readonly unchangedInARow: number;
  /** When this member's journal last grew. Null when we have never seen it grow. */
  readonly lastEntryAt: Date | null;
}

/** Where a member starts before we know anything about how they play. */
export function initialPoll(): PollState {
  return { intervalMs: START_MS, unchangedInARow: 0, lastEntryAt: null };
}

/**
 * The state after a poll.
 *
 * `changed` is whether the journal actually grew — not whether the request succeeded. A successful
 * request returning identical bytes is the signal that we are asking too often, and conflating the
 * two is what would keep a member pinned at the floor for ever.
 */
export function nextPoll(state: PollState, changed: boolean, now: Date): PollState {
  const lastEntryAt = changed ? now : state.lastEntryAt;
  const unchangedInARow = changed ? 0 : state.unchangedInARow + 1;

  /*
   * A member who has never been seen flying is idle, NOT fast. "No entries recently" and "no
   * entries at all" are the same absence, and treating them alike would poll somebody who linked
   * and never played at the fast cadence for ever.
   */
  const sinceEntry =
    lastEntryAt === null ? Number.POSITIVE_INFINITY : now.getTime() - lastEntryAt.getTime();

  if (sinceEntry >= IDLE_AFTER_MS) {
    return { intervalMs: IDLE_MS, unchangedInARow, lastEntryAt };
  }

  if (sinceEntry >= ACTIVE_WINDOW_MS) {
    return { intervalMs: MIDDLE_MS, unchangedInARow, lastEntryAt };
  }

  // Actively flying. This is the band the owner asked to speed up, and the only one that adapts.
  if (changed) {
    /*
     * Tighten. Frontier is producing entries at least as fast as we are asking, so asking faster
     * returns more — down to the floor, below which we are guaranteed to be spending the shared
     * limit on bytes we already have.
     */
    return {
      /*
       * Clamped to START_MS before halving, so ENTERING this band resets rather than halves.
       * Without it, a commander returning after a day away carries the 30-minute idle interval in
       * and their first poll lands fifteen minutes later — the worst possible moment to be slow,
       * because they have just started flying and nothing about them is current.
       */
      intervalMs: Math.max(ACTIVE_FLOOR_MS, Math.min(START_MS, Math.floor(state.intervalMs / 2))),
      unchangedInARow: 0,
      lastEntryAt,
    };
  }

  if (unchangedInARow >= PATIENCE) {
    /*
     * Widen, and reset the counter so the next widening needs its own three misses rather than
     * cascading. Capped at START_MS while they are still flying: a commander who is demonstrably
     * playing should not drift out to the idle interval merely because Frontier publishes slowly —
     * they are the person most likely to want fresh data.
     */
    return {
      intervalMs: Math.min(START_MS, state.intervalMs * 2),
      unchangedInARow: 0,
      lastEntryAt,
    };
  }

  return { intervalMs: state.intervalMs, unchangedInARow, lastEntryAt };
}
