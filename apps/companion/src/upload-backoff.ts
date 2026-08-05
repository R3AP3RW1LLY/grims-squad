/**
 * What to do when an upload is refused.
 *
 * ★ THE THIRTEEN-HOUR OUTAGE THIS EXISTS TO PREVENT ★
 *
 * `main.ts` used to call `stopPolling()` the first time an upload came back unauthorised, on the
 * reasoning that "the token is dead and will not recover".
 *
 * On 2026-07-30 that was wrong in production. Uploads stopped at 07:00 UTC and never resumed —
 * while the settings poll went on authenticating with THE SAME TOKEN every five minutes, returning
 * 200, for thirteen hours. The token was never dead. A transient refusal (a deploy, a restart, a
 * blip) is indistinguishable at the call site from a revoked one, and the app treated both as
 * terminal.
 *
 * It also failed INVISIBLY. The settings timer survived, so the app looked connected and healthy
 * the whole time it was sending nothing, and the first anyone knew was the roster showing members
 * offline while they were in game.
 *
 * ★ WHY BACKING OFF IS RIGHT AND STOPPING IS NOT ★
 *
 * `device_tokens` has no expiry column — a token is valid until somebody revokes it. So "it will
 * not recover" is almost never true, and when it is, the cost of being wrong is asymmetric: an
 * unnecessary request every half hour is nothing, and a member's whole session of missing
 * telemetry is not recoverable at all.
 *
 * ★ EXTRACTED SO IT CAN BE TESTED ★
 *
 * This lived inline in the Electron main process, which imports `electron` and cannot be unit
 * tested. Untestable code is where the original assumption survived unchallenged.
 */

/** Consecutive refusals before backing off. Two, so one blip during a deploy costs one pass. */
export const UNAUTHORISED_BEFORE_BACKOFF = 2;
export const BACKOFF_START_MS = 30_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

export interface BackoffState {
  /** Consecutive unauthorised responses. */
  readonly streak: number;
  /** Current delay, doubling per step. Zero when not backing off. */
  readonly delayMs: number;
  /** Epoch ms before which uploads are skipped. Zero when not backing off. */
  readonly until: number;
}

export const FRESH: BackoffState = { streak: 0, delayMs: 0, until: 0 };

/** Records a refused upload. */
export function onUnauthorised(state: BackoffState, now: number): BackoffState {
  const streak = state.streak + 1;
  if (streak < UNAUTHORISED_BEFORE_BACKOFF) {
    // Noted, but not yet acted on: the next pass tries again at the normal cadence.
    return { ...state, streak };
  }

  const delayMs =
    state.delayMs === 0 ? BACKOFF_START_MS : Math.min(state.delayMs * 2, BACKOFF_MAX_MS);
  return { streak, delayMs, until: now + delayMs };
}

/**
 * Records a pass that worked.
 *
 * Resets everything, including the delay. A single success means the condition has cleared, and
 * carrying the old delay forward would punish the next blip for a problem already solved.
 */
export function onSuccess(): BackoffState {
  return FRESH;
}

/**
 * Records that something else proved the credential still works.
 *
 * ★ THE SETTINGS POLL IS PROOF OF LIFE ★
 *
 * It authenticates with the same token against the same API. If it succeeds, the token is provably
 * alive and the backoff rests on a conclusion that has since been disproved — so uploading resumes
 * on the next pass rather than serving out a penalty for nothing.
 *
 * This alone would have self-healed the 2026-07-30 outage within five minutes.
 */
export function onProofOfLife(): BackoffState {
  return FRESH;
}

/** Whether this pass should skip uploading. */
export function shouldSkip(state: BackoffState, now: number): boolean {
  return state.until > 0 && now < state.until;
}

/**
 * What to tell the member.
 *
 * ★ SILENCE IS THE FAILURE MODE THAT HURT ★
 *
 * The old code stopped and looked fine. Whatever else changes, the window has to be able to say
 * "not sending" — so this returns a sentence rather than a boolean, and the caller has nothing to
 * compose.
 */
export function statusLine(state: BackoffState, now: number): string | null {
  if (!shouldSkip(state, now)) return null;
  const seconds = Math.ceil((state.until - now) / 1000);
  const wait = seconds < 90 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`;
  return `Not sending — the hub refused the last upload. Trying again in ${wait}.`;
}
