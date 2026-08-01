import { describe, expect, it, vi } from 'vitest';
import { awaitApproval, startLink, type LinkStarted } from './device-link.js';

/**
 * The poll loop is the part that can misbehave invisibly.
 *
 * An app that keeps polling after the link is dead looks fine on screen and quietly hammers an
 * endpoint forever. An app that gives up on the first dropped packet throws away an approval the
 * member has already granted, and they see the website say "connected" while the app still asks
 * them to sign in.
 */

const STARTED: LinkStarted = {
  code: 'K7M2-QP4X',
  pollSecret: 'secret',
  verifyUrl: 'https://example.test/link-device?code=K7M2-QP4X',
  expiresAt: 0,
};

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
const noSleep = async (): Promise<void> => undefined;

describe('startLink', () => {
  it('returns what the app needs and nothing it does not', async () => {
    const fetchImpl = vi.fn(async () =>
      ok({
        code: 'K7M2-QP4X',
        pollSecret: 'sssh',
        verifyUrl: 'https://example.test/link-device?code=K7M2-QP4X',
        expiresAt: '2026-08-01T12:10:00Z',
      }),
    );

    const started = await startLink('https://example.test/', 'Desktop', fetchImpl as never);
    expect(started.code).toBe('K7M2-QP4X');
    expect(started.pollSecret).toBe('sssh');
    expect(started.expiresAt).toBe(Date.parse('2026-08-01T12:10:00Z'));
    // Trailing slash on the base must not produce a double slash in the path.
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe('https://example.test/v1/telemetry/links');
  });

  it('fails loudly when the server refuses', async () => {
    // Not a poll state: "cannot reach the server" and "not approved yet" are different
    // conversations, and merging them leaves the app waiting for something that cannot arrive.
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    await expect(startLink('https://example.test', 'Desktop', fetchImpl as never)).rejects.toThrow('503');
  });

  it('refuses an answer it does not understand rather than half-working', async () => {
    const fetchImpl = vi.fn(async () => ok({ code: 'K7M2-QP4X' }));
    await expect(startLink('https://example.test', 'Desktop', fetchImpl as never)).rejects.toThrow(
      /does not understand/,
    );
  });
});

describe('awaitApproval', () => {
  it('waits through pending and returns the token on approval', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls < 3 ? ok({ status: 'pending' }) : ok({ status: 'approved', token: 'gsq_live' });
    });

    const out = await awaitApproval('https://example.test', STARTED, {
      fetchImpl: fetchImpl as never,
      sleep: noSleep,
    });
    expect(out).toEqual({ status: 'approved', token: 'gsq_live' });
    expect(calls).toBe(3);
  });

  it('MANDATORY: a dropped request does not lose an approval in progress', async () => {
    /*
     * The member is mid-approval in another window. Giving up on one failed request means they
     * press approve, see the website confirm it, and find the app still asking them to sign in —
     * with a device now paired that the app knows nothing about.
     */
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls <= 2) throw new Error('ECONNRESET');
      return ok({ status: 'approved', token: 'gsq_live' });
    });

    const out = await awaitApproval('https://example.test', STARTED, {
      fetchImpl: fetchImpl as never,
      sleep: noSleep,
    });
    expect(out).toEqual({ status: 'approved', token: 'gsq_live' });
  });

  it('MANDATORY: stops when the server says the link is gone', async () => {
    const fetchImpl = vi.fn(async () => ok({ status: 'gone' }));
    const out = await awaitApproval('https://example.test', STARTED, {
      fetchImpl: fetchImpl as never,
      sleep: noSleep,
    });
    expect(out).toEqual({ status: 'gone' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stops when the server says expired', async () => {
    const fetchImpl = vi.fn(async () => ok({ status: 'expired' }));
    const out = await awaitApproval('https://example.test', STARTED, {
      fetchImpl: fetchImpl as never,
      sleep: noSleep,
    });
    expect(out).toEqual({ status: 'expired' });
  });

  it('MANDATORY: stops on its own deadline even if the server never answers', async () => {
    /*
     * Without this, a server that became unreachable the moment the member pressed the button
     * leaves the loop retrying until somebody closes the app.
     */
    const fetchImpl = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    let t = 1_000;
    const out = await awaitApproval(
      'https://example.test',
      { ...STARTED, expiresAt: 5_000 },
      {
        fetchImpl: fetchImpl as never,
        sleep: async () => {
          t += 2_000;
        },
        now: () => t,
      },
    );
    expect(out).toEqual({ status: 'expired' });
  });

  it('stops when the member cancels', async () => {
    let cancelled = false;
    const fetchImpl = vi.fn(async () => {
      cancelled = true;
      return ok({ status: 'pending' });
    });

    const out = await awaitApproval('https://example.test', STARTED, {
      fetchImpl: fetchImpl as never,
      sleep: noSleep,
      cancelled: () => cancelled,
    });
    expect(out).toEqual({ status: 'cancelled' });
  });
});
