import { describe, it, expect } from 'vitest';
import {
  assertPromotionsPermitted,
  promotionsPermitted,
  EARLIEST_PROMOTION_AT,
  PromotionsNotYetPermittedError,
} from './promotion-floor.js';

/**
 * The human's instruction was explicit and non-negotiable: nothing is promoted
 * before 1 August 2026. These tests exist so that instruction survives being
 * forgotten — by me, in a later session, with no memory of this conversation.
 */
describe('promotion floor', () => {
  it('is 1 August 2026, 00:00 UTC', () => {
    expect(EARLIEST_PROMOTION_AT.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('REFUSES any moment before the floor', () => {
    for (const t of [
      '2026-07-27T22:00:00.000Z', // today
      '2026-07-31T23:59:59.999Z', // one millisecond short
      '2026-07-01T00:00:00.000Z', // the month being recorded
      '2020-01-01T00:00:00.000Z',
    ]) {
      expect(() => assertPromotionsPermitted(new Date(t))).toThrow(PromotionsNotYetPermittedError);
      expect(promotionsPermitted(new Date(t))).toBe(false);
    }
  });

  it('permits the floor instant itself and everything after', () => {
    expect(promotionsPermitted(new Date('2026-08-01T00:00:00.000Z'))).toBe(true);
    expect(promotionsPermitted(new Date('2026-09-01T00:00:00.000Z'))).toBe(true);
  });

  it('refuses a MANUAL run too — the guard is not the schedule', () => {
    // The whole point. A cron expression that has not fired yet stops nothing
    // if someone triggers the job by hand to see what it would do.
    expect(() => assertPromotionsPermitted(new Date('2026-07-31T12:00:00.000Z'))).toThrow(
      /not permitted until/i,
    );
  });

  it('says WHY in the message, so nobody removes the guard to unblock themselves', () => {
    try {
      assertPromotionsPermitted(new Date('2026-07-28T00:00:00.000Z'));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/non-negotiable/i);
      expect((e as Error).message).toContain('2026-08-01T00:00:00.000Z');
    }
  });
});
