import { describe, expect, it, vi } from 'vitest';
import { Bulkhead, BulkheadFullError } from './bulkhead.js';

/**
 * A ceiling on how much of the process one expensive route may consume.
 *
 * ★ WHY — THE OUTAGE OF 2026-08-06 ★
 *
 * `pg_stat_activity` showed twenty-five concurrent queries from the API container and TWENTY-FIVE
 * is the connection pool. Every one of them was the colonisation shopping list. Nothing was left
 * for anything else: sign-in, the roster, the health check the deploy gates on — all of it queued
 * behind one page's market lookups.
 *
 * Coalescing (see single-flight) removes the duplicate work, and the composite index made the
 * remaining work three hundred times cheaper. Both are fixes for THIS cause. A bulkhead is the fix
 * for the SHAPE of the failure: whatever the next expensive query turns out to be, it must not be
 * able to take the whole process with it.
 *
 * Shedding load is the point. A request refused in a millisecond is a far better outcome than one
 * that waits fourteen seconds and then times out at the proxy — the member gets an answer, and the
 * ninety-nine requests behind it still work.
 */

describe('one route cannot consume the whole process', () => {
  it('MANDATORY: it runs up to the limit concurrently', async () => {
    const bulkhead = new Bulkhead({ limit: 3, queue: 0 });
    let peak = 0;
    let running = 0;

    await Promise.all(
      Array.from({ length: 3 }, () =>
        bulkhead.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 10));
          running -= 1;
        }),
      ),
    );

    expect(peak).toBe(3);
  });

  it('MANDATORY: it refuses rather than queueing forever once full', async () => {
    /*
     * The behaviour that actually saves the site. An unbounded queue is not a bulkhead — it is the
     * same collapse with a longer fuse, and it is what fourteen-second responses looked like.
     */
    const bulkhead = new Bulkhead({ limit: 1, queue: 0 });
    const slow = bulkhead.run(() => new Promise((r) => setTimeout(r, 50)));

    await expect(bulkhead.run(async () => 'second')).rejects.toBeInstanceOf(BulkheadFullError);
    await slow;
  });

  it('MANDATORY: a permit is released even when the work throws', async () => {
    /*
     * The bug that turns a bulkhead into a deadlock: a permit leaked on the error path. After
     * `limit` failures the route is permanently closed and the only cure is a restart — which is
     * strictly worse than having no bulkhead at all.
     */
    const bulkhead = new Bulkhead({ limit: 1, queue: 0 });

    for (let i = 0; i < 5; i += 1) {
      await expect(bulkhead.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    }

    await expect(bulkhead.run(async () => 'still works')).resolves.toBe('still works');
  });

  it('MANDATORY: a queued caller runs once a permit frees', async () => {
    const bulkhead = new Bulkhead({ limit: 1, queue: 2 });
    const order: string[] = [];

    const first = bulkhead.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('first');
    });
    const second = bulkhead.run(async () => {
      order.push('second');
    });

    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('the queue is bounded too, or it is not a bulkhead', async () => {
    const bulkhead = new Bulkhead({ limit: 1, queue: 1 });
    const running = bulkhead.run(() => new Promise((r) => setTimeout(r, 40)));
    const queued = bulkhead.run(async () => 'queued');

    await expect(bulkhead.run(async () => 'overflow')).rejects.toBeInstanceOf(BulkheadFullError);

    await Promise.all([running, queued]);
  });

  it('reports how full it is, so the probe can see a storm coming', async () => {
    /*
     * The incident was invisible until members complained. A number that can be read before the
     * queue overflows is the difference between an alert and a bug report.
     */
    const bulkhead = new Bulkhead({ limit: 2, queue: 5 });
    const held = bulkhead.run(() => new Promise((r) => setTimeout(r, 30)));

    expect(bulkhead.stats().active).toBe(1);
    expect(bulkhead.stats().limit).toBe(2);

    await held;
    expect(bulkhead.stats().active).toBe(0);
  });
});

describe('the error says something a member can act on', () => {
  it('MANDATORY: it is a 503-shaped refusal, not a generic crash', async () => {
    const bulkhead = new Bulkhead({ limit: 1, queue: 0, name: 'colony-shopping' });
    const held = bulkhead.run(() => new Promise((r) => setTimeout(r, 30)));

    const error = await bulkhead.run(async () => 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BulkheadFullError);
    expect((error as BulkheadFullError).statusCode).toBe(503);
    expect((error as Error).message).toContain('busy');

    await held;
  });
});

describe('it does not slow down the ordinary case', () => {
  it('adds no waiting when there is capacity', async () => {
    const bulkhead = new Bulkhead({ limit: 10, queue: 10 });
    const work = vi.fn(async () => 'fast');

    const started = Date.now();
    await bulkhead.run(work);

    expect(work).toHaveBeenCalledOnce();
    expect(Date.now() - started).toBeLessThan(50);
  });
});
