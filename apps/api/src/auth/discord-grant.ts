/**
 * Keeping our session no longer alive than Discord's authorisation.
 *
 * ★ THE RULE ★
 *
 * A member stays signed in for as long as Discord will vouch for them, and is
 * signed out once it will not.
 *
 * ★ WHY THAT IS NOT THE SAME AS "FOREVER" ★
 *
 * Discord refresh tokens do not carry an expiry, so it is tempting to read
 * "as long as Discord allows" as "indefinitely". It is not. The authorisation
 * ends the moment any of these happens, and Discord tells us by refusing:
 *
 *   - the member revokes our app in their Discord settings
 *   - they change their password, which invalidates outstanding grants
 *   - Discord disables or deletes their account
 *   - we rotate our client secret
 *
 * Every one of those is somebody saying "stop", and continuing to honour a
 * thirty-day cookie afterwards would mean our idea of who they are outliving
 * theirs. That is the case this exists to close.
 *
 * ★ WHY NOT SIMPLY MAKE OUR SESSION LONGER ★
 *
 * Because the failure is silent in the wrong direction. A revoked Discord
 * authorisation with a live session here means someone who believes they have
 * removed our access still has it — and the only way they would find out is by
 * checking a page they have no reason to visit.
 */

export interface GrantState {
  /** When the Discord ACCESS token we hold stops working. */
  readonly tokenExpiresAt: Date | null;
  /** Whether we still hold a refresh token to renew it with. */
  readonly hasRefreshToken: boolean;
}

export type GrantVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'revoked' | 'expired' | 'unknown' };

/**
 * How long after the Discord access token expires we keep trusting it without
 * checking.
 *
 * Discord access tokens last a week. Re-checking on every request would be a
 * call to Discord per page view, and re-checking never would be the bug above.
 * A day's grace means a revocation is honoured within a day at worst, usually
 * far sooner, at a cost of roughly one call per member per day.
 */
export const GRANT_RECHECK_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Should this session continue?
 *
 * Deliberately conservative about the UNKNOWN case: a member with no recorded
 * Discord grant at all is left signed in rather than kicked out. Those rows
 * pre-date this check, and signing out the whole squadron because of a missing
 * column would be a far worse failure than a late revocation.
 */
export function grantStillValid(state: GrantState, now: Date): GrantVerdict {
  if (!state.hasRefreshToken) {
    /*
     * No refresh token means we cannot renew and cannot ask Discord anything.
     * Either they revoked us — Discord drops the token on revocation — or we
     * never stored one. Treated as revoked, which is the safe reading.
     */
    return { ok: false, reason: 'revoked' };
  }

  if (state.tokenExpiresAt === null) return { ok: true };

  const overdueBy = now.getTime() - state.tokenExpiresAt.getTime();
  if (overdueBy > GRANT_RECHECK_GRACE_MS) {
    // Expired and past its grace. The session ends; signing in again is one
    // click and re-establishes the grant.
    return { ok: false, reason: 'expired' };
  }

  return { ok: true };
}

/**
 * How long a session cookie may live, given what we know about the grant.
 *
 * Never longer than the ceiling, and never longer than the Discord grant has
 * left. A cookie that outlives the authorisation behind it is a cookie that
 * will fail confusingly rather than expire cleanly.
 */
export function sessionLifetimeSec(
  state: GrantState,
  ceilingSec: number,
  now: Date,
): number {
  if (state.tokenExpiresAt === null) return ceilingSec;

  const grantLeftMs =
    state.tokenExpiresAt.getTime() + GRANT_RECHECK_GRACE_MS - now.getTime();
  if (grantLeftMs <= 0) return 0;

  return Math.min(ceilingSec, Math.floor(grantLeftMs / 1000));
}
