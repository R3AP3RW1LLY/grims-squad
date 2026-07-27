import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InaraAdapter, InaraApiError, InaraNotApprovedError } from './inara.adapter.js';
import { resetInaraLimiterForTests } from './limiter.js';

/**
 * P1.8b — the Inara adapter.
 *
 * ★ THE ONE THING THESE TESTS EXIST FOR ★
 *
 * "events[0].eventStatus is checked, not merely the HTTP status" is an
 * acceptance criterion because Inara ALWAYS answers HTTP 200. A bad API key, a
 * malformed request and an unapproved application all arrive as 200 with the
 * real answer buried in the body.
 *
 * An adapter that trusts `res.ok` therefore reports success for every one of
 * those, hands the caller an empty body, and the nonce poller reads that as
 * "not there yet" — forever, silently, for every member. Nothing errors and
 * nobody is ever verified.
 */

const CONFIG = {
  appName: "Grim's Squad Hub",
  appVersion: '1.0.0',
  apiKey: 'test-key',
};

/** Inara's envelope, always delivered as HTTP 200. */
function inaraResponds(body: unknown, httpStatus = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: httpStatus >= 200 && httpStatus < 300,
      status: httpStatus,
      json: async () => body,
    })),
  );
}

const ok = (eventData: Record<string, unknown>) => ({
  header: { eventStatus: 200 },
  events: [{ eventStatus: 200, eventData }],
});

let adapter: InaraAdapter;

beforeEach(() => {
  // Every call queues behind the GLOBAL limiter (INV-033), so without this the
  // second call in the file waits a real 30 seconds. The limiter is deliberately
  // not injectable — a per-caller one would be the exact hole that invariant
  // exists to close — so the test discards the singleton instead. A fresh
  // limiter dispatches its first call immediately, which is what each test is.
  resetInaraLimiterForTests();
  adapter = new InaraAdapter(CONFIG);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading a profile', () => {
  it('returns the commander name and bio', async () => {
    inaraResponds(ok({ commanderName: 'GRIM', commanderBio: 'verify:GRIM-7X2Q' }));
    const p = await adapter.getCommanderProfile('GRIM');
    expect(p?.cmdrName).toBe('GRIM');
    expect(p?.bio).toContain('GRIM-7X2Q');
  });

  it('joins BOTH bio fields, because Inara has two', async () => {
    // A member may have put the nonce in either. Preferring one would fail
    // verification for everyone who chose the other, with no diagnosis.
    inaraResponds(ok({ commanderName: 'GRIM', userProfileText: 'nonce GRIM-7X2Q here' }));
    const p = await adapter.getCommanderProfile('GRIM');
    expect(p?.bio).toContain('GRIM-7X2Q');
  });

  it('MANDATORY: eventStatus 204 means NOT FOUND, and returns null', async () => {
    // An expected outcome — a typo'd commander name — not an exception. It must
    // be distinguishable from Inara being down, or someone who mistyped their
    // name is shown "service unavailable".
    inaraResponds({ header: { eventStatus: 200 }, events: [{ eventStatus: 204 }] });
    expect(await adapter.getCommanderProfile('NOBODY')).toBeNull();
  });
});

describe('@INV-031-adjacent: HTTP 200 is not success', () => {
  it('MANDATORY: throws on a FAILING eventStatus inside an HTTP 200', async () => {
    // The whole point. Without this the caller parses an empty body and reads
    // it as "the nonce is not in the bio yet" — forever.
    inaraResponds({
      header: { eventStatus: 200 },
      events: [{ eventStatus: 400, eventStatusText: 'Invalid request' }],
    });
    await expect((adapter.getCommanderProfile('GRIM'))).rejects.toThrow(/400|invalid/i);
  });

  it('MANDATORY: treats an unapproved or revoked API key as NOT retryable', async () => {
    // Retrying a rejected key forever burns the rate limit and never succeeds.
    // The caller has to be able to tell "stop asking" from "try again later".
    inaraResponds({ header: { eventStatus: 401, eventStatusText: 'Access denied' } });

    // ONE call, both assertions. A second call here would legitimately queue
    // 30 seconds behind the global limiter — which is the limiter working, not
    // a fault, and is not what this test is about.
    const err = await adapter.getCommanderProfile('GRIM').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InaraNotApprovedError);
    expect(err).toMatchObject({ retryable: false });
  });

  it('treats a 5xx eventStatus as retryable', async () => {
    inaraResponds({ header: { eventStatus: 500, eventStatusText: 'Server error' } });
    await expect((adapter.getCommanderProfile('GRIM'))).rejects.toMatchObject({ retryable: true });
  });

  it('throws when the envelope carries no event at all', async () => {
    // A 200 with an empty events array is not "no results" — 204 is. This is a
    // shape we do not understand, and guessing is how the silent-failure bug
    // gets reintroduced.
    inaraResponds({ header: { eventStatus: 200 }, events: [] });
    await expect((adapter.getCommanderProfile('GRIM'))).rejects.toThrow(/no event/i);
  });

  it('still reports a genuine HTTP failure', async () => {
    inaraResponds({}, 503);
    await expect((adapter.getCommanderProfile('GRIM'))).rejects.toBeInstanceOf(InaraApiError);
  });

  it('a network failure is retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );
    await expect((adapter.getCommanderProfile('GRIM'))).rejects.toMatchObject({ retryable: true });
  });
});

describe('the request', () => {
  it('sends the API key in the header block, not the query string', async () => {
    inaraResponds(ok({ commanderName: 'GRIM' }));
    await (adapter.getCommanderProfile('GRIM'));

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const [url, init] = call as [string, { body: string }];
    // A key in a URL lands in proxy logs and error reports.
    expect(url).not.toContain('test-key');
    expect(JSON.parse(init.body).header.APIkey).toBe('test-key');
  });

  it('asks for exactly one event', async () => {
    inaraResponds(ok({ commanderName: 'GRIM' }));
    await (adapter.getCommanderProfile('GRIM'));
    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const body = JSON.parse((call as [string, { body: string }])[1].body);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].eventName).toBe('getCommanderProfile');
  });
});
