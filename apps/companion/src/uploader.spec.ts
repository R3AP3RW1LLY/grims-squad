import { describe, it, expect } from 'vitest';
import { Uploader, MAX_BATCH } from './uploader.js';
import type { ParsedEvent } from './journal-reader.js';

/**
 * Sending events to the hub.
 *
 * ★ FAILURE MUST NEVER MEAN LOSS ★
 *
 * A failed send does not advance the saved offset, so the events are read and
 * sent again next pass and the server dedupes them. That is only safe because
 * the event key includes the payload — which is why "just retry" is the right
 * default here rather than a route to double-counting.
 */
const event = (n: number): ParsedEvent => ({
  name: 'Rank',
  occurredAt: `2026-07-27T12:00:${String(n).padStart(2, '0')}Z`,
  data: { Combat: n },
});

function fakeFetch(handler: (init: RequestInit) => Partial<Response> & { json?: () => unknown }) {
  return (async (_url: string, init: RequestInit) => {
    const r = handler(init);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => (r.json ? r.json() : {}),
    } as Response;
  }) as unknown as typeof fetch;
}

describe('sending', () => {
  it('posts events and reports what was accepted', async () => {
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: fakeFetch(() => ({ json: () => ({ accepted: 2, duplicates: 1 }) })),
    });

    const r = await up.send([event(1), event(2)]);
    expect(r.ok).toBe(true);
    expect(r.accepted).toBe(2);
    expect(r.duplicates).toBe(1);
  });

  it('MANDATORY: authenticates with a BEARER token, never a cookie', async () => {
    // The app is not a browser and must not carry a session. The device token
    // is its whole identity, and it is scoped to telemetry alone.
    let seen: Record<string, string> = {};
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: fakeFetch((init) => {
        seen = init.headers as Record<string, string>;
        return {};
      }),
    });

    await up.send([event(1)]);
    expect(seen['authorization']).toBe('Bearer gsq_test');
    expect(JSON.stringify(seen)).not.toMatch(/cookie/i);
  });

  it('sends nothing when there is nothing to send', async () => {
    let called = false;
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: fakeFetch(() => {
        called = true;
        return {};
      }),
    });

    expect((await up.send([])).ok).toBe(true);
    expect(called).toBe(false);
  });

  it('caps the batch size', async () => {
    // One long session must not post a ten-megabyte body.
    let count = 0;
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: fakeFetch((init) => {
        count = (JSON.parse(init.body as string) as { events: unknown[] }).events.length;
        return {};
      }),
    });

    await up.send(Array.from({ length: MAX_BATCH + 50 }, (_, i) => event(i)));
    expect(count).toBe(MAX_BATCH);
  });
});

describe('failures', () => {
  it('MANDATORY: a revoked token is reported as unauthorised, not as an outage', async () => {
    /*
     * They are different conditions with different remedies: an outage clears
     * by itself, a revoked token never will. Retrying it forever would hammer
     * the server and leave the member wondering why nothing ever updates.
     */
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_revoked',
      fetchImpl: fakeFetch(() => ({ ok: false, status: 401 })),
    });

    const r = await up.send([event(1)]);
    expect(r.unauthorised).toBe(true);
    expect(r.error).toMatch(/pair it again/i);
  });

  it('treats being offline as retryable, not as unauthorised', async () => {
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });

    const r = await up.send([event(1)]);
    expect(r.ok).toBe(false);
    expect(r.unauthorised).toBe(false);
    expect(r.error).toMatch(/could not reach/i);
  });

  it('MANDATORY: never throws — the app must survive the hub being down', async () => {
    // This runs on a timer in a background process. An unhandled rejection
    // here is a crash the member sees as the app "stopping for no reason".
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: (async () => {
        throw new Error('anything at all');
      }) as unknown as typeof fetch,
    });

    await expect(up.send([event(1)])).resolves.toMatchObject({ ok: false });
  });

  it('reports a server error without claiming the token is bad', async () => {
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: fakeFetch(() => ({ ok: false, status: 503 })),
    });

    const r = await up.send([event(1)]);
    expect(r.unauthorised).toBe(false);
    expect(r.error).toContain('503');
  });
});
