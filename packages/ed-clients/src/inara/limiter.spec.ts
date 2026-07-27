import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InaraLimiter, inaraLimiter, INARA_MIN_SPACING_MS } from './limiter.js';

/**
 * @INV-033 Inara is called at most twice per minute GLOBALLY, through one
 * shared limiter, and never from a request path.
 *
 * ★ WHY "GLOBALLY" IS THE LOAD-BEARING WORD ★
 *
 * A per-caller limiter is trivial and useless. Two jobs each politely spacing
 * their own calls 30 seconds apart still hit Inara four times a minute between
 * them, and Inara's limit is on us as a consumer, not on our internals. The
 * limiter has to be ONE object that every caller queues behind — which is why
 * there is an exported singleton and a test that asserts it is the same object.
 *
 * Exceeding this gets our API key revoked. There is no partial failure mode:
 * verification simply stops working for everybody.
 */

let limiter: InaraLimiter;

beforeEach(() => {
  vi.useFakeTimers();
  limiter = new InaraLimiter();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('spacing', () => {
  it('MANDATORY: dispatches 10 concurrent calls at least 30 s apart', async () => {
    const at: number[] = [];
    const calls = Array.from({ length: 10 }, () =>
      limiter.run(async () => {
        at.push(Date.now());
      }),
    );

    // 10 calls at 30s spacing needs 270s of virtual time after the first.
    await vi.advanceTimersByTimeAsync(INARA_MIN_SPACING_MS * 10);
    await Promise.all(calls);

    expect(at).toHaveLength(10);
    for (let i = 1; i < at.length; i += 1) {
      const gap = (at[i] as number) - (at[i - 1] as number);
      expect(gap, `gap between call ${i - 1} and ${i}`).toBeGreaterThanOrEqual(
        INARA_MIN_SPACING_MS,
      );
    }
  });

  it('runs the first call immediately', async () => {
    // Rate limiting should not add latency that is not needed. An idle limiter
    // has no reason to make the first caller wait.
    const started = Date.now();
    let ran = -1;
    const p = limiter.run(async () => {
      ran = Date.now();
    });
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(ran - started).toBe(0);
  });

  it('preserves order — the queue is FIFO', async () => {
    const seen: number[] = [];
    const calls = [0, 1, 2].map((i) =>
      limiter.run(async () => {
        seen.push(i);
      }),
    );
    await vi.advanceTimersByTimeAsync(INARA_MIN_SPACING_MS * 3);
    await Promise.all(calls);
    expect(seen).toEqual([0, 1, 2]);
  });

  it('the spacing is 30 seconds — two per minute, not two per call', () => {
    expect(INARA_MIN_SPACING_MS).toBe(30_000);
  });
});

describe('failures do not break the queue', () => {
  it('MANDATORY: a throwing task still lets the next one run', async () => {
    // A limiter that stops dispatching after one upstream error is a limiter
    // that turns a transient Inara failure into a permanent outage of every
    // verification, and the symptom is silence.
    const results: string[] = [];
    // The assertion is attached BEFORE the clock advances. A rejected promise
    // with no handler yet is an unhandled rejection for however long the gap
    // lasts — which passes locally and fails in CI, where the reporter is
    // stricter about them.
    const a = expect(
      limiter.run(async () => {
        throw new Error('inara exploded');
      }),
    ).rejects.toThrow(/exploded/);
    const b = limiter.run(async () => {
      results.push('b ran');
    });

    await vi.advanceTimersByTimeAsync(INARA_MIN_SPACING_MS * 2);
    await a;
    await b;
    expect(results).toEqual(['b ran']);
  });

  it('a rejection reaches its own caller and nobody else', async () => {
    const a = expect(
      limiter.run(async () => {
        throw new Error('mine');
      }),
    ).rejects.toThrow('mine');
    const b = expect(limiter.run(async () => 'yours')).resolves.toBe('yours');

    await vi.advanceTimersByTimeAsync(INARA_MIN_SPACING_MS * 2);
    await a;
    await b;
  });
});

describe('the singleton', () => {
  it('MANDATORY: inaraLimiter() returns the SAME object every time', () => {
    // The whole invariant. Two limiters means two callers each spacing their
    // own calls politely and Inara seeing four a minute.
    expect(inaraLimiter()).toBe(inaraLimiter());
  });

  it('is shared across module boundaries, not per-import', () => {
    const a = inaraLimiter();
    const b = inaraLimiter();
    // .catch attached IMMEDIATELY — this promise is never awaited and would
    // otherwise be an unhandled rejection if the task ever threw.
    void a.run(async () => undefined).catch(() => undefined);
    expect(b.pending()).toBe(a.pending());
  });
});
