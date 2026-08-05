import { describe, it, expect } from 'vitest';
import { etaSeconds, ingestFraction, REFRESH_HOURS } from './ai-knowledge.js';

/**
 * The training page's countdown.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "at least an estimate that adjusts as it goes so its always showing an accurate time."
 *
 * The adjusting is the whole requirement, and it is the part that is easy to get subtly wrong in a
 * way that never errors — a countdown that is confidently incorrect is worse than none, because
 * somebody plans around it.
 */

const START = new Date('2026-08-01T12:00:00Z');
const at = (seconds: number) => new Date(START.getTime() + seconds * 1000);

describe('the countdown', () => {
  it('extrapolates from the rate observed so far', () => {
    // 100k rows in 60s = 1,666/s. 300k remaining -> about 180s.
    const eta = etaSeconds({
      startedAt: START,
      rowsSoFar: 100_000,
      expectedRows: 400_000,
      now: at(60),
    });
    expect(eta).toBe(180);
  });

  it('MANDATORY: grows when the import slows down', () => {
    /*
     * ★ WHY THIS IS THE IMPORTANT ONE ★
     *
     * Between page refreshes the row count is FROZEN and elapsed keeps climbing. That must make the
     * estimate get worse, not stay still — a stalling import should visibly lengthen rather than
     * promise the same four minutes for ever, which is exactly how a hung job goes unnoticed.
     */
    const early = etaSeconds({ startedAt: START, rowsSoFar: 100_000, expectedRows: 400_000, now: at(60) });
    const later = etaSeconds({ startedAt: START, rowsSoFar: 100_000, expectedRows: 400_000, now: at(120) });

    expect(later).toBeGreaterThan(early ?? 0);
  });

  it('shortens when it speeds up', () => {
    const slow = etaSeconds({ startedAt: START, rowsSoFar: 100_000, expectedRows: 400_000, now: at(60) });
    const fast = etaSeconds({ startedAt: START, rowsSoFar: 300_000, expectedRows: 400_000, now: at(60) });

    expect(fast).toBeLessThan(slow ?? Infinity);
  });

  it('MANDATORY: returns null rather than inventing a number', () => {
    /*
     * A missing estimate is honest. A made-up one gets believed — and every one of these cases
     * genuinely cannot be known.
     */
    // Nothing running.
    expect(etaSeconds({ startedAt: null, rowsSoFar: 1, expectedRows: 2, now: at(60) })).toBeNull();
    // First ever run: no previous total to compare against.
    expect(etaSeconds({ startedAt: START, rowsSoFar: 1_000, expectedRows: null, now: at(60) })).toBeNull();
    // Nothing written yet: no rate to divide by.
    expect(etaSeconds({ startedAt: START, rowsSoFar: 0, expectedRows: 400_000, now: at(60) })).toBeNull();
    // Too early to measure anything.
    expect(etaSeconds({ startedAt: START, rowsSoFar: 10, expectedRows: 400_000, now: at(0) })).toBeNull();
    // Already past last time's total — the guess was low, and negative time is not an answer.
    expect(etaSeconds({ startedAt: START, rowsSoFar: 500_000, expectedRows: 400_000, now: at(60) })).toBeNull();
  });
});

describe('the bar', () => {
  it('clamps past the end, because the target is only a guess', () => {
    expect(ingestFraction(500_000, 400_000)).toBe(1);
  });

  it('is null when there is nothing to measure against', () => {
    // Rendered as indeterminate rather than as zero: "working, length unknown" beats "stuck".
    expect(ingestFraction(1_000, null)).toBeNull();
    expect(ingestFraction(null, 400_000)).toBeNull();
  });
});

describe('how often we look', () => {
  it('MANDATORY: checks Coriolis every few hours, not weekly', () => {
    /*
     * Squadron owner: "why is this so long ... can we not do this on like a 2-3 hour schedule?"
     *
     * Affordable because the job asks GitHub for one commit id and stops when it matches. The old
     * weekly value meant a game update could be six days old before the assistant knew a module
     * existed.
     */
    expect(REFRESH_HOURS.coriolis).toBeLessThanOrEqual(3);
  });
});
