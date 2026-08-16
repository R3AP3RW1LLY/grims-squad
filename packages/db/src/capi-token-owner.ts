/**
 * One owner for a Frontier refresh.
 *
 * ★ THE FAILURE THIS CLOSES ★
 *
 * Frontier ROTATES the refresh token: issuing a new one kills the old one immediately. So when two
 * processes refresh the same member at once, both send the same still-valid refresh token, Frontier
 * honours whichever arrives first and invalidates it — and the loser then PERSISTS a token that is
 * already dead.
 *
 * That member's link is gone, and nothing anywhere errors. The write succeeded, the row looks
 * healthy, and the next poll simply gets `invalid_grant`. It reads exactly like the 25-day ceiling
 * expiring early, so the natural diagnosis is "they need to reconnect" — which they do, over and
 * over, for as long as the two refreshers keep colliding.
 *
 * ★ WHY IT BECAME REACHABLE NOW ★
 *
 * The API has always refreshed on demand, and while it was the only refresher this was theoretical.
 * The journal poller makes a SECOND process refresh the same rows on a timer, for the members most
 * likely to be active — which is precisely when the API is also being asked for their token.
 *
 * ★ WHY THE LOCK WAITS, UNLIKE `job-lock.ts` NEXT DOOR ★
 *
 * A job lock uses `pg_try_advisory_lock` and DECLINES when somebody else holds it, because a second
 * nightly reconcile should not queue up behind the first. Here declining would be wrong: the caller
 * wants a usable token, and the process holding the lock is in the middle of producing exactly that.
 * So this waits, and the loser re-reads the row afterwards and finds the winner's fresh token
 * already stored — one refresh, two satisfied callers.
 *
 * ★ AND WHY DETECTION IS NOT AN OPTION ★
 *
 * The obvious cheaper fix is a conditional write — "update only if the refresh token is still the
 * one I read". It does not work here: the loser's write is not what fails. By the time it writes it
 * has already spent the shared refresh token, and Frontier has already killed the good one. The race
 * has to be prevented, not detected.
 */

/** "capi", so these cannot collide with the job locks or any other feature's advisory locks. */
export const CAPI_LOCK_NAMESPACE = 0x63_61_70_69;

/**
 * A stable per-member lock id. Same member, same number, in every process.
 *
 * ★ THE TWO PROPERTIES THAT MATTER ★
 *
 * Stable, or the lock is held on one number while the other process refreshes freely — a lock that
 * looks like it works and prevents nothing. And inside int4, because `pg_advisory_lock(int, int)`
 * takes two 32-bit keys and anything larger is an error from the database in the middle of a token
 * refresh. `lockIdFor` in `job-lock.ts` carries the same note for the same reason.
 */
export function capiLockKey(userId: string): number {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % 2_147_483_647;
}

/**
 * How long before expiry a token is refreshed anyway.
 *
 * A token with three seconds left is not usable: it will have expired by the time the request it
 * was fetched for reaches Frontier, and the failure lands on the member rather than here.
 */
const SKEW_MS = 60_000;

export interface StoredToken {
  /** The encrypted access token, or null when the row was written by an interrupted exchange. */
  readonly accessEnc: string | null;
  readonly expiresAt: Date | null;
}

/**
 * Whether this row needs a trip to Frontier at all.
 *
 * ★ REFRESHING A LIVE TOKEN IS NOT FREE ★
 *
 * Every refresh rotates. A poller that refreshed on every pass would spend the shared rate limit on
 * nothing AND widen the window in which two processes are mid-rotation together — manufacturing the
 * very race this module exists to close. So a token with real time left is used as it is.
 */
export function shouldRefresh(token: StoredToken, now: Date): boolean {
  // Null is not "valid for ever". Assuming it were pins a member on a token nothing renews, and the
  // only symptom is requests failing for a reason nothing states.
  if (token.accessEnc === null || token.expiresAt === null) return true;
  return token.expiresAt.getTime() - now.getTime() <= SKEW_MS;
}

/** Just enough of a pg client to take a session-scoped lock. */
export interface LockSession {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

/**
 * Runs `fn` with the member's refresh lock held, and releases it however `fn` ends.
 *
 * ★ A DEDICATED SESSION, LIKE THE JOB LOCK ★
 *
 * The lock belongs to the SESSION. Taking it on Prisma's pooled connection would release it the
 * moment the pool handed that connection back — while the refresh was still in flight, which is the
 * exact window it exists to protect.
 *
 * ★ THE RELEASE IS IN A `finally` FOR A REASON ★
 *
 * A refresh that throws is the common case, not the rare one: Frontier rate limits, and grants die.
 * Leaking the lock on those paths would block that member's token for the life of the process, and
 * the symptom would be one member silently never updating again.
 */
export async function withCapiRefreshLock<T>(
  session: LockSession,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await session.query('SELECT pg_advisory_lock($1, $2)', [CAPI_LOCK_NAMESPACE, capiLockKey(userId)]);
  try {
    return await fn();
  } finally {
    await session
      .query('SELECT pg_advisory_unlock($1, $2)', [CAPI_LOCK_NAMESPACE, capiLockKey(userId)])
      .catch(() => undefined);
    await session.end().catch(() => undefined);
  }
}
