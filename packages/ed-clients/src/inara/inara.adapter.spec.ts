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

/**
 * Batched profile reads.
 *
 * ★ WHY THESE ARE WORTH TESTING SEPARATELY ★
 *
 * Inara answers a batch POSITIONALLY: result three belongs to name three, and
 * nothing in the payload says so. Every failure mode here is silent — an
 * off-by-one writes one commander's ranks onto another's card, a short array
 * shifts everyone after it, and nobody sees an error in either case.
 */
describe('InaraAdapter.getCommanderProfiles', () => {
  const batch = (events: unknown[]) => ({ header: { eventStatus: 200 }, events });

  it('asks about many commanders in ONE request', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => batch([
        { eventStatus: 200, eventData: { commanderName: 'ALPHA' } },
        { eventStatus: 200, eventData: { commanderName: 'BETA' } },
        { eventStatus: 200, eventData: { commanderName: 'GAMMA' } },
      ]),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await adapter.getCommanderProfiles(['ALPHA', 'BETA', 'GAMMA']);

    // THE POINT OF THE WHOLE FEATURE: three commanders, one request. At one
    // request each, a 20-minute sweep of the squadron is impossible under the
    // global 2/min limit.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.size).toBe(3);

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body);
    expect(body.events).toHaveLength(3);
    expect(body.events.map((e: { eventData: { searchName: string } }) => e.eventData.searchName))
      .toEqual(['ALPHA', 'BETA', 'GAMMA']);
  });

  it('aligns each result with the name that was sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => batch([
        { eventStatus: 200, eventData: { commanderRanksPilot: [{ rankName: 'trade', rankValue: 8 }] } },
        { eventStatus: 204 },
        { eventStatus: 200, eventData: { commanderRanksPilot: [{ rankName: 'combat', rankValue: 3 }] } },
      ]),
    })));

    const out = await adapter.getCommanderProfiles(['ALPHA', 'BETA', 'GAMMA']);

    // Middle one absent, and the third must NOT slide up into its place.
    expect(out.get('alpha')?.pilotRanks).toEqual([{ rankName: 'trade', rankValue: 8 }]);
    expect(out.get('beta')).toBeNull();
    expect(out.get('gamma')?.pilotRanks).toEqual([{ rankName: 'combat', rankValue: 3 }]);
  });

  it('leaves names ABSENT when the reply is shorter than the request', async () => {
    // A short reply means Inara disagrees with us about what we asked. Recording
    // the survivors as found and the rest as "not found" would be a guess; the
    // missing ones must simply not appear, so the next sweep retries them.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => batch([{ eventStatus: 200, eventData: { commanderName: 'ALPHA' } }]),
    })));

    const out = await adapter.getCommanderProfiles(['ALPHA', 'BETA']);

    expect(out.has('alpha')).toBe(true);
    expect(out.has('beta')).toBe(false);
  });

  it('splits a large squadron into several requests', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => batch(Array.from({ length: 30 }, () => ({ eventStatus: 204 }))),
    }));
    vi.stubGlobal('fetch', fetchMock);

    /*
      FAKE TIMERS, and not for speed — the global limiter really does space
      requests 30s apart (INV-033), so three chunks genuinely take a minute.
      Waiting it out would make the suite slower than the feature.

      That the wait EXISTS is the reassuring part: it is the proof that batching
      did not quietly acquire a second code path around the limiter.
    */
    vi.useFakeTimers();
    try {
      const names = Array.from({ length: 70 }, (_, i) => `CMDR${i}`);
      const pending = adapter.getCommanderProfiles(names);
      await vi.advanceTimersByTimeAsync(300_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    // 70 names at 30 per request. The cap is enforced in the adapter so no
    // caller can send one enormous body and get the app throttled.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('de-duplicates names differing only by case', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => batch([{ eventStatus: 204 }]),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await adapter.getCommanderProfiles(['Pebble', 'PEBBLE', 'pebble']);

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body);
    // Elite names are case-insensitive, so this is one question, not three —
    // and rate budget spent asking it three times is budget stolen from
    // somebody else's card.
    expect(body.events).toHaveLength(1);
  });

  it('does not let one bad event discard the rest of its batch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => batch([
        { eventStatus: 200, eventData: { commanderName: 'ALPHA' } },
        { eventStatus: 500, eventStatusText: 'nope' },
      ]),
    })));

    const out = await adapter.getCommanderProfiles(['ALPHA', 'BETA']);

    expect(out.get('alpha')?.cmdrName).toBe('ALPHA');
    // Errored, so unknown rather than "not found" — retried next sweep.
    expect(out.has('beta')).toBe(false);
  });

  it('gives up entirely when our key is rejected', async () => {
    // Not retryable and not per-commander: every remaining chunk would fail the
    // same way, so burning the rate budget to prove it is pure waste.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ header: { eventStatus: 401, eventStatusText: 'no access' } }),
    })));

    await expect(adapter.getCommanderProfiles(['ALPHA'])).rejects.toBeInstanceOf(
      InaraNotApprovedError,
    );
  });
});
