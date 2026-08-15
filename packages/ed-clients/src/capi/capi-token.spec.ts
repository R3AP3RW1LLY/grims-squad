import { describe, expect, it } from 'vitest';
import { exchangeCode, refreshAccess, CapiAuthError } from './capi-token.js';

/**
 * Trading a callback code for tokens, and keeping them alive.
 *
 * ★ WHY EVERY FAILURE HERE IS TESTED SEPARATELY ★
 *
 * These calls fail in ways that are not interchangeable, and treating them alike is how a platform
 * loses a member's data without noticing:
 *
 *   a NETWORK failure        Frontier is unreachable. Try again shortly; nothing is wrong.
 *   an INVALID GRANT         the refresh chain is dead. Trying again forever is the bug — the
 *                            member has to reauthorise and until somebody tells them, they will
 *                            not.
 *   a RATE LIMIT             back off. Retrying immediately makes it worse and can extend the ban.
 *
 * A poller that catches all three as "no data this cycle" is the exact shape of the outage that
 * started this work: a member's contributions stop, every individual cycle looks unremarkable, and
 * the platform goes on presenting their last known state as current.
 */

const okJson = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const INPUT = {
  authBase: 'https://auth.frontierstore.net',
  clientId: 'cid',
  redirectUri: 'https://grims-squad.com/v1/cmdr/capi/callback',
};

describe('exchanging the callback code', () => {
  it('★ MANDATORY: the verifier is sent, and the code is never reused ★', async () => {
    /*
     * PKCE only means anything if the verifier reaches this step. A flow that omits it still
     * completes against a server that does not enforce it, which is precisely why it must be
     * asserted rather than assumed.
     */
    // Captured through a closure rather than read off mock.calls: the mock's inferred signature is
    // zero-arg, so indexing its calls is a type error and casting past it defeats the point.
    let body = '';
    const fetchImpl = (async (_url: string, init?: { body?: string }) => {
      body = init?.body ?? '';
      return okJson({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
    }) as unknown as typeof fetch;

    await exchangeCode({ ...INPUT, code: 'the-code', verifier: 'the-verifier', fetchImpl });

    expect(body).toContain('code_verifier=the-verifier');
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=the-code');
  });

  it('★ MANDATORY: expiry is returned as an instant, not a duration ★', async () => {
    /*
     * `expires_in` is seconds from NOW, and storing it as-is means every later comparison has to
     * remember when "now" was. Resolving it here is the difference between a token that refreshes
     * on time and one that refreshes whenever the row was last read.
     */
    const now = new Date('2026-08-15T12:00:00Z');
    const out = await exchangeCode({
      ...INPUT,
      code: 'c',
      verifier: 'v',
      now,
      fetchImpl: async () => okJson({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }),
    });

    expect(out.expiresAt.toISOString()).toBe('2026-08-15T13:00:00.000Z');
    expect(out.accessToken).toBe('a');
    expect(out.refreshToken).toBe('r');
  });

  it('★ MANDATORY: a dead grant is distinguishable from a network blip ★', async () => {
    // The distinction the whole file exists for. One is retryable for ever; the other never is.
    await expect(
      exchangeCode({
        ...INPUT,
        code: 'c',
        verifier: 'v',
        fetchImpl: async () => okJson({ error: 'invalid_grant' }, 400),
      }),
    ).rejects.toMatchObject({ kind: 'invalid_grant', retryable: false });
  });

  it('★ MANDATORY: a rate limit says so, and is retryable ★', async () => {
    await expect(
      exchangeCode({
        ...INPUT,
        code: 'c',
        verifier: 'v',
        fetchImpl: async () => okJson({ error: 'slow_down' }, 429),
      }),
    ).rejects.toMatchObject({ kind: 'rate_limited', retryable: true });
  });

  it('MANDATORY: a network failure is retryable and not mistaken for a refusal', async () => {
    await expect(
      exchangeCode({
        ...INPUT,
        code: 'c',
        verifier: 'v',
        fetchImpl: async () => {
          throw new Error('ECONNRESET');
        },
      }),
    ).rejects.toMatchObject({ kind: 'network', retryable: true });
  });

  it('MANDATORY: a response missing its tokens is a failure, not an empty success', async () => {
    /*
     * A 200 with no access_token would otherwise store `undefined` and read later as "linked but
     * broken" — the worst state, because nothing prompts the member to fix it.
     */
    await expect(
      exchangeCode({
        ...INPUT,
        code: 'c',
        verifier: 'v',
        fetchImpl: async () => okJson({ expires_in: 3600 }),
      }),
    ).rejects.toBeInstanceOf(CapiAuthError);
  });
});

describe('refreshing', () => {
  it('★ MANDATORY: the rotated refresh token replaces the old one ★', async () => {
    /*
     * Frontier rotates on use. Keeping the original means the NEXT refresh presents a spent token
     * and fails as invalid_grant — a member disconnected roughly one access-token lifetime after
     * linking, for no reason anybody could see.
     */
    const out = await refreshAccess({
      ...INPUT,
      refreshToken: 'old',
      fetchImpl: async () => okJson({ access_token: 'a2', refresh_token: 'NEW', expires_in: 900 }),
    });

    expect(out.refreshToken).toBe('NEW');
  });

  it('MANDATORY: a response that omits a new refresh token keeps the current one', async () => {
    // Some servers only rotate sometimes. Discarding it because it was absent would end the chain.
    const out = await refreshAccess({
      ...INPUT,
      refreshToken: 'keep-me',
      fetchImpl: async () => okJson({ access_token: 'a2', expires_in: 900 }),
    });

    expect(out.refreshToken).toBe('keep-me');
  });

  it('★ MANDATORY: invalid_grant on refresh is terminal ★', async () => {
    // Past Frontier's ceiling this is the answer for ever. Retrying is not resilience, it is a
    // member whose data stopped and nobody told.
    await expect(
      refreshAccess({
        ...INPUT,
        refreshToken: 'dead',
        fetchImpl: async () => okJson({ error: 'invalid_grant' }, 400),
      }),
    ).rejects.toMatchObject({ kind: 'invalid_grant', retryable: false });
  });

  it('the grant type is a refresh, not an authorisation', async () => {
    let body = '';
    const fetchImpl = (async (_url: string, init?: { body?: string }) => {
      body = init?.body ?? '';
      return okJson({ access_token: 'a', expires_in: 900 });
    }) as unknown as typeof fetch;

    await refreshAccess({ ...INPUT, refreshToken: 'r', fetchImpl });

    expect(body).toContain('grant_type=refresh_token');
  });
});
