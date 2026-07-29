import { describe, it, expect } from 'vitest';
import { publishEvents, notifyLive, type LiveEvent } from './live-notify.js';

/**
 * A scheduled job telling the website something changed.
 *
 * The behaviour worth pinning down is what happens when Redis misbehaves,
 * because the job has ALREADY COMMITTED its work by the time it gets here. A
 * squadron re-check that verified eleven members and could not send a
 * notification has done its job completely, and must not report otherwise.
 */

class FakeRedis {
  readonly published: Array<{ channel: string; message: string }> = [];
  quitCalls = 0;
  /** Indexes of publish calls that should throw. */
  failAt = new Set<number>();
  #n = 0;

  async publish(channel: string, message: string): Promise<number> {
    const i = this.#n++;
    if (this.failAt.has(i)) throw new Error('connection lost');
    this.published.push({ channel, message });
    return 1;
  }

  async quit(): Promise<'OK'> {
    this.quitCalls += 1;
    return 'OK';
  }
}

const events: LiveEvent[] = [
  { type: 'verification', userId: 'u1' },
  { type: 'verification', userId: 'u2' },
  { type: 'verification', userId: 'u3' },
];

describe('publishEvents', () => {
  it('sends one message per event, on the channel the API subscribes to', async () => {
    const redis = new FakeRedis();
    const sent = await publishEvents(redis, events);

    expect(sent).toBe(3);
    expect(redis.published.map((p) => p.channel)).toEqual(['grims:live', 'grims:live', 'grims:live']);
    expect(JSON.parse(redis.published[0]!.message)).toEqual({ type: 'verification', userId: 'u1' });
  });

  /*
   * ★ ONE FAILURE MUST NOT ABANDON THE REST ★
   *
   * These are independent members. Stopping at the first failed publish would
   * mean a momentary blip decided that everybody after the second in the list
   * waits for a manual reload — for no reason, since the next publish would
   * very likely have succeeded.
   */
  it('carries on past a failed publish and reports the honest count', async () => {
    const redis = new FakeRedis();
    redis.failAt.add(1);

    const sent = await publishEvents(redis, events);

    expect(sent).toBe(2);
    expect(redis.published.map((p) => JSON.parse(p.message).userId)).toEqual(['u1', 'u3']);
  });

  it('reports zero when nothing could be sent, rather than claiming success', async () => {
    const redis = new FakeRedis();
    redis.failAt = new Set([0, 1, 2]);

    expect(await publishEvents(redis, events)).toBe(0);
  });

  /*
   * Not a formality. `publishEvents` is what the interesting tests exercise, and
   * a bug that sent the WRONG member's id would pass every count-based
   * assertion above.
   */
  it('names the member the event is about', async () => {
    const redis = new FakeRedis();
    await publishEvents(redis, [{ type: 'verification', userId: 'aurelian' }]);

    expect(JSON.parse(redis.published[0]!.message)).toEqual({
      type: 'verification',
      userId: 'aurelian',
    });
  });
});

describe('notifyLive', () => {
  /*
   * ★ NO EVENTS, NO CONNECTION ★
   *
   * The common case for every job is that nothing changed. Opening a Redis
   * connection to send nothing would make a quiet sweep depend on Redis being
   * up — and this runs every fifteen minutes, so it would be the single most
   * frequent way for the worker to touch infrastructure it does not need.
   *
   * Verifiable without a Redis precisely BECAUSE it must not connect: if this
   * returned anything other than 0 it would have had to dial out, and the test
   * would hang or throw rather than pass.
   */
  it('does not connect when there is nothing to say', async () => {
    expect(await notifyLive([])).toBe(0);
  });

  /*
   * There is no Redis in the test environment, so this exercises the real
   * failure path: connection refused. It must resolve with 0, not reject —
   * a job that verified members and could not notify them has still succeeded.
   */
  it('never throws when Redis cannot be reached', async () => {
    const previous = process.env['REDIS_URL'];
    // A port nothing listens on, so the connection is refused immediately
    // rather than the test waiting out a timeout.
    process.env['REDIS_URL'] = 'redis://127.0.0.1:1';
    try {
      await expect(notifyLive([{ type: 'verification', userId: 'u1' }])).resolves.toBe(0);
    } finally {
      if (previous === undefined) delete process.env['REDIS_URL'];
      else process.env['REDIS_URL'] = previous;
    }
  });
});
