import { describe, it, expect } from 'vitest';
import {
  grantStillValid,
  sessionLifetimeSec,
  GRANT_RECHECK_GRACE_MS,
} from './discord-grant.js';

/**
 * Our session must not outlive Discord's authorisation.
 *
 * ★ THE FAILURE THIS EXISTS TO CLOSE ★
 *
 * Somebody revokes our app in their Discord settings, and stays signed in here
 * for the remaining twenty-nine days of their cookie. They have said "stop" and
 * we have carried on, and the only way they would discover it is by visiting a
 * page they have no reason to visit.
 */

const NOW = new Date('2026-07-27T12:00:00Z');
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe('whether the session continues', () => {
  it('MANDATORY: ends when Discord no longer has a grant for us', () => {
    /*
     * Discord DROPS the refresh token on revocation, so its absence is how a
     * revocation reaches us. Read as revoked, which is the safe direction: the
     * cost of being wrong is one sign-in, and the cost of the other error is
     * access somebody believes they have withdrawn.
     */
    const verdict = grantStillValid({ tokenExpiresAt: hoursFromNow(24), hasRefreshToken: false }, NOW);

    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe('revoked');
  });

  it('continues while the Discord token is live', () => {
    expect(grantStillValid({ tokenExpiresAt: hoursFromNow(24), hasRefreshToken: true }, NOW).ok).toBe(
      true,
    );
  });

  it('MANDATORY: continues through the grace window rather than logging somebody out mid-session', () => {
    /*
     * A Discord access token that expired an hour ago is normal — they last a
     * week and we renew lazily. Ending the session on the minute would sign
     * members out at arbitrary moments for no security benefit, because we
     * still hold a refresh token and Discord will still vouch for them.
     */
    const justExpired = new Date(NOW.getTime() - 60 * 60 * 1000);
    expect(grantStillValid({ tokenExpiresAt: justExpired, hasRefreshToken: true }, NOW).ok).toBe(true);
  });

  it('MANDATORY: ends once the grace window is past', () => {
    const longGone = new Date(NOW.getTime() - GRANT_RECHECK_GRACE_MS - 60_000);
    const verdict = grantStillValid({ tokenExpiresAt: longGone, hasRefreshToken: true }, NOW);

    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe('expired');
  });

  it('MANDATORY: leaves a session with no recorded grant alone', () => {
    /*
     * Conservative on purpose. Rows predating this check have no expiry
     * recorded, and signing out the entire squadron because of a missing column
     * would be a far worse failure than honouring a revocation a day late.
     */
    expect(grantStillValid({ tokenExpiresAt: null, hasRefreshToken: true }, NOW).ok).toBe(true);
  });
});

describe('how long the cookie may live', () => {
  it('MANDATORY: never longer than the ceiling', () => {
    // The Discord grant being generous does not make our own session policy
    // generous. Thirty days is our number and it still applies.
    const thirtyDays = 30 * 24 * 60 * 60;
    const lifetime = sessionLifetimeSec(
      { tokenExpiresAt: hoursFromNow(24 * 365), hasRefreshToken: true },
      thirtyDays,
      NOW,
    );
    expect(lifetime).toBe(thirtyDays);
  });

  it('MANDATORY: never longer than the grant behind it', () => {
    /*
     * The whole point. A cookie outliving the authorisation it depends on does
     * not fail cleanly — it fails confusingly, at some later moment, in the
     * middle of whatever the member was doing.
     */
    const thirtyDays = 30 * 24 * 60 * 60;
    const lifetime = sessionLifetimeSec(
      { tokenExpiresAt: hoursFromNow(2), hasRefreshToken: true },
      thirtyDays,
      NOW,
    );

    expect(lifetime).toBeLessThan(thirtyDays);
    // Two hours plus the grace window.
    expect(lifetime).toBe(2 * 3600 + GRANT_RECHECK_GRACE_MS / 1000);
  });

  it('is zero once the grant is fully gone', () => {
    const lifetime = sessionLifetimeSec(
      { tokenExpiresAt: new Date(NOW.getTime() - GRANT_RECHECK_GRACE_MS - 1), hasRefreshToken: true },
      3600,
      NOW,
    );
    expect(lifetime).toBe(0);
  });

  it('falls back to the ceiling when nothing is recorded', () => {
    expect(sessionLifetimeSec({ tokenExpiresAt: null, hasRefreshToken: true }, 900, NOW)).toBe(900);
  });

  it('never returns a negative lifetime', () => {
    // A negative maxAge is a cookie the browser deletes immediately, which
    // would look like an instant sign-out rather than an expired session.
    for (const hours of [-1000, -24, -1, 0, 1]) {
      const lifetime = sessionLifetimeSec(
        { tokenExpiresAt: hoursFromNow(hours), hasRefreshToken: true },
        3600,
        NOW,
      );
      expect(lifetime, String(hours)).toBeGreaterThanOrEqual(0);
    }
  });
});
