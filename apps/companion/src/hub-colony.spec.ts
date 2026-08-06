import { describe, expect, it, vi } from 'vitest';
import { hubColony } from './hub-colony.js';

/**
 * The companion's own share of the outage of 2026-08-06.
 *
 * ★ WHAT THE HUB'S LOG SHOWED ★
 *
 * Nine GETs for the SAME colonisation project inside three hundred milliseconds, sustained, from
 * this app. Each one made the hub price every commodity in the build. Response times climbed from
 * 667ms to 14,646ms, the hub's entire database connection pool went to that one route, and the
 * squadron owner reported that the companion would not connect at all.
 *
 * It would not connect because it was the thing stopping it connecting. Every timeout produced
 * another attempt, and every attempt made the next timeout more likely.
 *
 * The hub now coalesces and sheds load, which stops this hurting anyone else. This is the other
 * half: the app should not have been asking nine times in the first place.
 */

const call = (fetchImpl: typeof fetch) => ({
  apiBaseUrl: 'https://hub.example',
  deviceToken: 'device-token',
  fetchImpl,
});

function jsonOnce(body: unknown, delayMs = 0): typeof fetch {
  return (async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('the app asks once, however many times it is asked to', () => {
  it('MANDATORY: concurrent GETs of the same path make one request', async () => {
    const impl = vi.fn(jsonOnce({ id: 'p1' }, 20));

    const all = await Promise.all(
      Array.from({ length: 9 }, () => hubColony<{ id: string }>(call(impl), '/projects/p1')),
    );

    expect(impl, 'nine identical GETs produced more than one request to the hub').toHaveBeenCalledTimes(1);
    expect(all.every((a) => a.ok)).toBe(true);
  });

  it('MANDATORY: different paths are not shared', async () => {
    /*
     * The dangerous way to get this wrong: one in-flight slot, so a request for project B receives
     * project A's data. Wrong data shown confidently is worse than the outage it replaces.
     */
    const seen: string[] = [];
    const impl = (async (url: string) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => ({ url }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const [a, b] = await Promise.all([
      hubColony<{ url: string }>(call(impl), '/projects/a'),
      hubColony<{ url: string }>(call(impl), '/projects/b'),
    ]);

    expect(seen).toHaveLength(2);
    expect(a.ok && a.data.url).toContain('/projects/a');
    expect(b.ok && b.data.url).toContain('/projects/b');
  });

  it('MANDATORY: writes are never coalesced', async () => {
    /*
     * Two members each joining a project, or one member pressing a button twice, are two events.
     * Sharing a POST would silently drop one of them — and unlike a slow read, a dropped write is
     * invisible until somebody notices the delivery they logged is missing.
     */
    const impl = vi.fn(jsonOnce({ ok: true }, 10));

    await Promise.all([
      hubColony(call(impl), '/projects/p1/join', { method: 'POST' }),
      hubColony(call(impl), '/projects/p1/join', { method: 'POST' }),
    ]);

    expect(impl, 'two POSTs were collapsed into one — a write was silently dropped').toHaveBeenCalledTimes(2);
  });

  it('MANDATORY: a finished request does not block the next one', async () => {
    /*
     * Dedupe must last exactly as long as the flight. Holding the entry afterwards would turn this
     * into a cache the member cannot refresh — they press reload and see yesterday's numbers.
     */
    const impl = vi.fn(jsonOnce({ id: 'p1' }));

    await hubColony(call(impl), '/projects/p1');
    await hubColony(call(impl), '/projects/p1');

    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('MANDATORY: a failure reaches every waiter', async () => {
    const impl = (async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const all = await Promise.all(
      Array.from({ length: 4 }, () => hubColony(call(impl), '/projects/p1')),
    );

    // hubColony turns failures into sentences rather than throwing — every caller must get one.
    expect(all.every((a) => !a.ok)).toBe(true);
  });
});
