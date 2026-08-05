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

/**
 * A stand-in for `fetch`.
 *
 * ★ THE BODY IS A STRING, AS IT IS IN A REAL RESPONSE ★
 *
 * This used to expose only `json()`. That made it a fake of something that does
 * not exist: a real Response carries bytes, and `json()` is one of two ways to
 * read them. When the uploader started reading `text()` — so it could MEASURE
 * those bytes — the fake returned undefined and every send looked like a
 * network failure.
 *
 * Both readers now come from one string, so the size the test sees is the size
 * the uploader counts, and neither can drift from the other.
 */
interface FakeResponseSpec {
  ok?: boolean;
  status?: number;
  /** The body, as an object. Serialised once and read back both ways. */
  json?: () => unknown;
}

function fakeFetch(handler: (init: RequestInit) => FakeResponseSpec) {
  return (async (_url: string, init: RequestInit) => {
    const r = handler(init);
    const body = JSON.stringify(r.json ? r.json() : {});
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: async () => body,
      json: async () => JSON.parse(body) as unknown,
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

  it('caps each request, and sends the remainder rather than dropping it', async () => {
    /*
     * ★ THE LOSS THIS TEST EXISTS FOR ★
     *
     * This used to assert that a 250-event chunk produced ONE request of 200 —
     * and it passed, because that is exactly what the code did. The other fifty
     * were discarded, and the watcher advanced its file offset anyway, so they
     * were never read again. The test documented the bug as the specification.
     */
    const sizes: number[] = [];
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: fakeFetch((init) => {
        sizes.push((JSON.parse(init.body as string) as { events: unknown[] }).events.length);
        return {};
      }),
    });

    await up.send(Array.from({ length: MAX_BATCH + 50 }, (_, i) => event(i)));

    expect(sizes).toEqual([MAX_BATCH, 50]);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(MAX_BATCH + 50);
  });

  it('splits on BYTES before it reaches the event count', async () => {
    /*
     * A `Market` event carries a station's whole commodity list. Two hundred of
     * them is megabytes against a hub that accepts one — a 413 that would fail
     * the ordinary events riding along with them.
     */
    // Shaped like the real thing: around a hundred commodities, each with the
    // full set of fields Frontier writes. That is ~25KB an event.
    const item = (n: number) => ({
      id: 128049204 + n,
      Name: '$platinum_name;',
      Name_Localised: 'Platinum',
      Category: '$MARKET_category_metals;',
      Category_Localised: 'Metals',
      BuyPrice: 0,
      SellPrice: 58_432,
      MeanPrice: 57_962,
      StockBracket: 0,
      DemandBracket: 3,
      Stock: 0,
      Demand: 12_450,
      Consumer: true,
      Producer: false,
      Rare: false,
    });
    const heavy = Array.from({ length: 60 }, (_, i) => ({
      name: 'Market',
      occurredAt: `2026-08-01T11:00:${String(i % 60).padStart(2, '0')}Z`,
      data: {
        MarketID: 3223343616 + i,
        StationName: 'Jameson Memorial',
        StarSystem: 'Shinrarta Dezhra',
        Items: Array.from({ length: 110 }, (_, n) => item(n)),
      },
    }));

    const bodies: number[] = [];
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: fakeFetch((init) => {
        bodies.push(Buffer.byteLength(init.body as string, 'utf8'));
        return {};
      }),
    });

    await up.send(heavy);

    // More than one request despite being well under the event cap...
    expect(bodies.length).toBeGreaterThan(1);
    // ...and every one of them inside the hub's limit.
    for (const b of bodies) expect(b).toBeLessThan(1024 * 1024);
  });

  it('reports a mid-way failure as failure, so the offset does not advance', async () => {
    /*
     * The batches that landed are re-sent next pass and deduped on the event
     * key. Reporting ok:true because SOME of it worked would advance the offset
     * past events that never arrived.
     */
    let n = 0;
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: fakeFetch(() => {
        n += 1;
        if (n === 2) throw new Error('network gone');
        return {};
      }),
    });

    const r = await up.send(Array.from({ length: MAX_BATCH + 50 }, (_, i) => event(i)));

    expect(r.ok).toBe(false);
    expect(n).toBe(2);
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

describe('measuring the transfer', () => {
  /*
   * ★ MEASURED, NOT ESTIMATED ★
   *
   * The squadron owner asked for this to be "extremely accurate". So the byte
   * count comes from the very string handed to fetch, not from re-serialising
   * the events afterwards — two serialisations can differ, and the one nobody
   * checks is the one that is wrong.
   */
  it('MANDATORY: txBytes is the exact byte length of the body sent', async () => {
    let sentBody = '';
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: ((async (_url: string, init: RequestInit) => {
        sentBody = init.body as string;
        return {
          ok: true,
          status: 200,
          text: async () => '{"accepted":1}',
          json: async () => ({ accepted: 1 }),
        } as Response;
      }) as unknown) as typeof fetch,
    });

    const r = await up.send([event(1)]);
    expect(r.txBytes).toBe(Buffer.byteLength(sentBody, 'utf8'));
    expect(r.rxBytes).toBe(Buffer.byteLength('{"accepted":1}', 'utf8'));
  });

  it('MANDATORY: counts BYTES, not characters', async () => {
    /*
     * A commander name with an accent is more bytes than characters. `.length`
     * would under-report every non-ASCII payload, and the members it
     * under-reports for would never know.
     */
    const accented: ParsedEvent = {
      name: 'Rank',
      occurredAt: '2026-07-27T12:00:00Z',
      data: { Ship: 'Zoë’s Rêve' },
    };

    let sentBody = '';
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: ((async (_url: string, init: RequestInit) => {
        sentBody = init.body as string;
        return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) } as Response;
      }) as unknown) as typeof fetch,
    });

    const r = await up.send([accented]);
    expect(r.txBytes).toBe(Buffer.byteLength(sentBody, 'utf8'));
    expect(r.txBytes).toBeGreaterThan(sentBody.length);
  });

  it('MANDATORY: a failed request still reports what it put on the wire', async () => {
    // Those bytes went out regardless. A meter that hid them would under-report
    // exactly when somebody is watching it to work out why nothing arrives.
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });

    const r = await up.send([event(1)]);
    expect(r.ok).toBe(false);
    expect(r.txBytes).toBeGreaterThan(0);
  });

  it('counts nothing when nothing is sent', async () => {
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: fakeFetch(() => ({})),
    });

    const r = await up.send([]);
    expect(r.txBytes).toBe(0);
    expect(r.rxBytes).toBe(0);
  });

  it('survives a 200 that is not JSON, and still counts it', async () => {
    // A proxy error page with a 200 status. The bytes are real even though the
    // body is useless.
    const up = new Uploader({
      apiBaseUrl: 'https://hub.example',
      deviceToken: 'gsq_test',
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        text: async () => '<html>nope</html>',
        json: async () => {
          throw new Error('not json');
        },
      })) as unknown as typeof fetch,
    });

    const r = await up.send([event(1)]);
    expect(r.ok).toBe(true);
    expect(r.accepted).toBe(0);
    expect(r.rxBytes).toBe(Buffer.byteLength('<html>nope</html>', 'utf8'));
  });
});
