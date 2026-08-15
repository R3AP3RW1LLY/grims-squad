import { describe, expect, it } from 'vitest';
import {
  CAPI_REFRESH_CEILING_DAYS,
  authorizeUrl,
  makePkce,
  refreshDue,
  tokenState,
} from './capi-auth.js';

/**
 * Frontier's Companion API, and the three date decisions that make it work or quietly stop.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "we want to pull realtime journal info for all commanders ... the primary feature must be so that
 * players that are playing on Geforce Now and cloud platforms can use the companion app like
 * everyone else"
 *
 * ★ WHY THE DATE ARITHMETIC IS THE HARD PART ★
 *
 * There are three clocks and they are not the same:
 *
 *   the ACCESS token   minutes. Refreshed constantly and nobody ever sees it.
 *   the REFRESH token  used to get a new access token, and rotated each time.
 *   the CEILING        Frontier stops honouring the chain about 25 days after the member
 *                      authorised, whatever we do. Already recorded in the schema as
 *                      "verifiedAt + 25 days. Frontier refresh tokens have a hard ceiling."
 *
 * Confusing the second with the third is the failure that matters: a member's data stops arriving,
 * every individual refresh looks fine right up until it does not, and the platform goes on showing
 * their last known cargo as though it were current. That is precisely the harm the stale-reading
 * warning was built for, arriving through a different door.
 */

const at = (iso: string): Date => new Date(iso);

describe('PKCE', () => {
  it('★ MANDATORY: the challenge is the S256 hash of the verifier, not the verifier ★', async () => {
    /*
     * Sending the verifier as the challenge is a real and silent mistake: the flow COMPLETES,
     * because Frontier only compares what we send at the end against what we sent at the start.
     * It just removes every protection PKCE exists to provide.
     */
    const a = await makePkce();

    expect(a.challenge).not.toBe(a.verifier);
    expect(a.method).toBe('S256');
  });

  it('★ MANDATORY: two flows never share a verifier ★', async () => {
    // A fixed verifier would let anyone who has seen one authorisation complete another.
    const [a, b] = await Promise.all([makePkce(), makePkce()]);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it('MANDATORY: the verifier is url-safe and long enough to be worth having', async () => {
    // RFC 7636 puts the floor at 43 characters and forbids padding.
    const { verifier, challenge } = await makePkce();

    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(challenge).not.toContain('=');
  });
});

describe('the authorisation url', () => {
  const url = (over: Partial<Parameters<typeof authorizeUrl>[0]> = {}): URL =>
    new URL(
      authorizeUrl({
        authBase: 'https://auth.frontierstore.net',
        clientId: 'cid',
        redirectUri: 'https://grims-squad.com/v1/cmdr/capi/callback',
        state: 'st',
        challenge: 'ch',
        ...over,
      }),
    );

  it('★ MANDATORY: it carries the challenge and never the verifier ★', () => {
    const u = url();
    expect(u.searchParams.get('code_challenge')).toBe('ch');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.toString(), 'a verifier in the browser is a verifier in a log').not.toContain('verifier');
  });

  it('★ MANDATORY: it asks for the scope the journal needs ★', () => {
    // Without `capi` there is no journal, and the GeForce Now case is the whole point.
    expect(url().searchParams.get('scope')).toContain('capi');
  });

  it('MANDATORY: state is carried, because a callback without it cannot be trusted', () => {
    expect(url().searchParams.get('state')).toBe('st');
    expect(url().searchParams.get('response_type')).toBe('code');
  });
});

describe('when to refresh, and when to stop', () => {
  const authorised = at('2026-08-01T00:00:00Z');

  it('★ MANDATORY: an access token close to expiry is refreshed BEFORE it fails ★', () => {
    /*
     * Refreshing on 401 means every member's first request after expiry fails, and a poller that
     * treats a failure as "nothing new" loses that cycle silently.
     */
    expect(refreshDue(at('2026-08-02T00:05:00Z'), at('2026-08-02T00:00:00Z'))).toBe(true);
  });

  it('MANDATORY: a fresh access token is left alone', () => {
    expect(refreshDue(at('2026-08-02T01:00:00Z'), at('2026-08-02T00:00:00Z'))).toBe(false);
  });

  it('★ MANDATORY: past the ceiling it is STALE, not merely expired ★', () => {
    /*
     * The distinction the owner asked for: "warn early, degrade honestly". Past the ceiling no
     * refresh will ever succeed again, so continuing to try is not resilience — it is a member
     * whose data silently stopped and a platform that never said so.
     */
    const past = at('2026-08-27T00:00:00Z'); // 26 days
    const state = tokenState(authorised, past);

    expect(state.stale).toBe(true);
    expect(state.daysLeft).toBe(0);
    expect(state.warn).toBe(true);
    expect(state.sentence).toMatch(/reconnect|reauthoris|expired/i);
  });

  it('★ MANDATORY: a week out it warns while everything still works ★', () => {
    // Early enough to act on. A warning that arrives at expiry is an outage notice.
    const state = tokenState(authorised, at('2026-08-20T00:00:00Z')); // 19 days in, 6 left

    expect(state.stale).toBe(false);
    expect(state.warn).toBe(true);
    expect(state.daysLeft).toBe(6);
    expect(state.sentence).toMatch(/6/);
  });

  it('MANDATORY: freshly authorised says nothing at all', () => {
    const state = tokenState(authorised, at('2026-08-02T00:00:00Z'));

    expect(state.warn).toBe(false);
    expect(state.stale).toBe(false);
    expect(state.daysLeft).toBe(24);
  });

  it('MANDATORY: the ceiling matches what the schema already promises', () => {
    // schema.prisma: "For cAPI: verifiedAt + 25 days. Frontier refresh tokens have a hard ceiling."
    expect(CAPI_REFRESH_CEILING_DAYS).toBe(25);
  });

  it('a clock skew into the future never reports negative days', () => {
    const state = tokenState(authorised, at('2026-07-30T00:00:00Z'));
    expect(state.daysLeft).toBeLessThanOrEqual(CAPI_REFRESH_CEILING_DAYS);
    expect(state.daysLeft).toBeGreaterThanOrEqual(0);
  });
});
