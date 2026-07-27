/**
 * The hard floor on promotions.
 *
 * ★ NON-NEGOTIABLE HUMAN INSTRUCTION (2026-07-27). ★
 * Nothing may be promoted before 1 August 2026, 00:00 UTC.
 *
 * This is a coded guard rather than a cron expression on purpose. A schedule
 * that does not fire yet is not a safeguard: someone runs the job by hand to
 * test it and 49 people are promoted on partial July data, publicly, in a way
 * that is tedious to unwind. The floor has to be something the code checks
 * every time, not something the calendar happens to prevent.
 *
 * July 2026 is partial by construction — the bot began recording on 27 July and
 * backfilled only to the 1st — so it can never be a fair qualifying month.
 */

export const EARLIEST_PROMOTION_AT = new Date('2026-08-01T00:00:00.000Z');

export class PromotionsNotYetPermittedError extends Error {
  constructor(now: Date) {
    super(
      `Promotions are not permitted until ${EARLIEST_PROMOTION_AT.toISOString()}. ` +
        `It is currently ${now.toISOString()}. This floor is a non-negotiable ` +
        `instruction, not a configuration value.`,
    );
    this.name = 'PromotionsNotYetPermittedError';
  }
}

/**
 * Throws unless promotions are permitted. Call this before ANY write that
 * changes a member's rank — including a manual or "just testing" invocation.
 */
export function assertPromotionsPermitted(now: Date = new Date()): void {
  if (now.getTime() < EARLIEST_PROMOTION_AT.getTime()) {
    throw new PromotionsNotYetPermittedError(now);
  }
}

/** True when a promotion run is allowed to write. */
export function promotionsPermitted(now: Date = new Date()): boolean {
  return now.getTime() >= EARLIEST_PROMOTION_AT.getTime();
}
