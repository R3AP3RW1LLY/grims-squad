import { describe, it, expect } from 'vitest';
import { sinceSeen, goneQuiet, QUIET_AFTER_DAYS } from './activity-freshness';

/**
 * The "last seen" column on the activity tab.
 *
 * ★ DISCORD, NOT THE WEBSITE ★
 *
 * Squadron owner, 2026-07-29. Somebody can read the site every day without
 * saying a word to anyone, so a sign-in says nothing about whether they are
 * still part of the squadron.
 */
const NOW = new Date('2026-07-29T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 86_400_000;

describe('how long since they were seen', () => {
  it('reads in hours for the first two days', () => {
    expect(sinceSeen(ago(3 * 3_600_000), NOW)).toBe('3 hours');
    expect(sinceSeen(ago(1 * 3_600_000), NOW)).toBe('1 hour');
    expect(sinceSeen(ago(47 * 3_600_000), NOW)).toBe('47 hours');
  });

  it('switches to days after that', () => {
    expect(sinceSeen(ago(2 * DAY), NOW)).toBe('2 days');
    expect(sinceSeen(ago(120 * DAY), NOW)).toBe('120 days');
  });

  it('MANDATORY: a clock skewed ahead does not render a negative age', () => {
    // It would otherwise read "-3 hours", which looks like a fault in the site
    // rather than in a clock.
    expect(sinceSeen(new Date(NOW + 3 * 3_600_000).toISOString(), NOW)).toBe('just now');
  });

  it('survives an unparseable value', () => {
    expect(sinceSeen('not a date', NOW)).toBe('');
  });
});

describe('gone quiet', () => {
  it('MANDATORY: flags over ninety days and not under', () => {
    expect(goneQuiet(ago(89 * DAY), NOW)).toBe(false);
    expect(goneQuiet(ago(91 * DAY), NOW)).toBe(true);
    expect(QUIET_AFTER_DAYS).toBe(90);
  });

  it('MANDATORY: NEVER seen counts as quiet', () => {
    /*
     * The quietest case there is, and exactly who the column was asked for.
     * Treating null as "not stale" would leave them unflagged — and null is
     * common, because voice occupancy was never backfillable, so somebody who
     * only ever sat in a channel has nothing recorded before the bot started.
     */
    expect(goneQuiet(null, NOW)).toBe(true);
  });

  it('an unparseable date is not evidence of silence', () => {
    // We do not know, and painting a row red on a parse failure would accuse
    // somebody of being absent on the strength of a bug.
    expect(goneQuiet('not a date', NOW)).toBe(false);
  });

  it('is exclusive at the boundary', () => {
    expect(goneQuiet(ago(QUIET_AFTER_DAYS * DAY), NOW)).toBe(false);
    expect(goneQuiet(ago(QUIET_AFTER_DAYS * DAY + 1), NOW)).toBe(true);
  });
});
