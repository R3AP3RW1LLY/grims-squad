import { describe, expect, it, vi } from 'vitest';
import { SingleFlight } from './single-flight.js';

/**
 * One computation per key, however many callers ask for it.
 *
 * ★ WHY THIS EXISTS — THE OUTAGE OF 2026-08-06 ★
 *
 * The API log showed NINE requests for the same colonisation project within three hundred
 * milliseconds, sustained. Each one ran the project's shopping list, which prices every commodity
 * the build needs — sixty to ninety market queries apiece. The companion app was retrying because
 * the endpoint was slow, and the retries were what made it slow.
 *
 * Response times climbed 667ms → 14,646ms and the API's entire connection pool went to that one
 * route. The squadron owner's report was "the companion app is not connecting at all", which was
 * true, and the cause was the companion app.
 *
 * A cache alone does not fix that. Nine simultaneous misses are still nine computations — the
 * cache only helps the tenth caller, and a stampede never gets that far. What fixes it is
 * COALESCING: the first caller computes, the other eight wait on the same promise.
 */

describe('a stampede becomes one computation', () => {
  it('MANDATORY: concurrent callers for one key run the work once', async () => {
    const flight = new SingleFlight();
    const work = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return 'answer';
    });

    const all = await Promise.all(
      Array.from({ length: 9 }, () => flight.run('project-a', 60_000, work)),
    );

    expect(work, 'nine callers produced more than one computation').toHaveBeenCalledTimes(1);
    expect(all).toEqual(Array(9).fill('answer'));
  });

  it('MANDATORY: different keys do not share an answer', async () => {
    /*
     * The obvious way to get coalescing wrong: one shared in-flight slot, so a request for project
     * B silently receives project A's shopping list. That is worse than the outage — it is wrong
     * data delivered quickly, to the wrong member.
     */
    const flight = new SingleFlight();

    const [a, b] = await Promise.all([
      flight.run('project-a', 60_000, async () => 'A'),
      flight.run('project-b', 60_000, async () => 'B'),
    ]);

    expect(a).toBe('A');
    expect(b).toBe('B');
  });

  it('MANDATORY: a fresh answer is reused instead of recomputed', async () => {
    const flight = new SingleFlight();
    const work = vi.fn(async () => 'answer');

    await flight.run('k', 60_000, work);
    await flight.run('k', 60_000, work);
    await flight.run('k', 60_000, work);

    expect(work).toHaveBeenCalledTimes(1);
  });

  it('MANDATORY: a stale answer is recomputed', async () => {
    /*
     * Prices move. A shopping list that never expires is a different bug report — "it keeps
     * showing a station that sold out yesterday" — and the fix for congestion must not create it.
     */
    vi.useFakeTimers();
    try {
      const flight = new SingleFlight();
      const work = vi.fn(async () => 'answer');

      await flight.run('k', 1_000, work);
      vi.advanceTimersByTime(1_500);
      await flight.run('k', 1_000, work);

      expect(work).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a failure does not become permanent', () => {
  it('MANDATORY: a rejection is never cached', async () => {
    /*
     * Caching a failure is how a five-second database blip becomes a five-minute outage. The next
     * caller must be allowed to try again.
     */
    const flight = new SingleFlight();
    let attempt = 0;
    const work = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('transient');
      return 'recovered';
    };

    await expect(flight.run('k', 60_000, work)).rejects.toThrow('transient');
    await expect(flight.run('k', 60_000, work)).resolves.toBe('recovered');
  });

  it('MANDATORY: every waiter on a failed flight sees the failure', async () => {
    /*
     * The waiters must not hang. A promise that neither resolves nor rejects is how a request
     * times out at the proxy with nothing in the log to explain it.
     */
    const flight = new SingleFlight();
    const work = async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('boom');
    };

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => flight.run('k', 60_000, work)),
    );

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });
});

describe('the cache cannot grow without limit', () => {
  it('MANDATORY: it evicts, so a distinct key per request cannot exhaust memory', async () => {
    /*
     * The key includes the origin coordinates and the filters, so it is effectively unbounded —
     * a member dragging a radius slider mints a new key per pixel. Without eviction this is a slow
     * memory leak in the one process members talk to.
     */
    const flight = new SingleFlight({ maxEntries: 10 });

    for (let i = 0; i < 50; i += 1) {
      await flight.run(`key-${i}`, 60_000, async () => i);
    }

    expect(flight.size).toBeLessThanOrEqual(10);
  });
});
