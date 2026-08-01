import { describe, expect, it } from 'vitest';
import { formatTenure, tenureBetween, tenureFrom } from './tenure.js';

/**
 * How long somebody has been in the squadron.
 *
 * The interesting cases are all calendar cases: month lengths differ, February moves, and a member
 * who joined on the 31st has no anniversary in most months. Getting any of them wrong produces a
 * number that is plausible, wrong, and only noticed by the one member it is wrong about.
 */

const at = (iso: string) => new Date(iso);

describe('tenureBetween', () => {
  it('counts whole years and months by the calendar', () => {
    const t = tenureBetween(at('2024-03-03T00:00:00Z'), at('2026-06-03T00:00:00Z'));
    expect([t.years, t.months, t.days]).toEqual([2, 3, 0]);
  });

  it('MANDATORY: a 29 February anniversary clamps to the 28th', () => {
    /*
     * Someone who joined on 29 February 2024 has been here exactly 365 days on 28 February 2025.
     * Telling them "11 months" because their join date does not exist that year is the sort of
     * answer that gets reported as a bug once a year and never reproduced.
     */
    const t = tenureBetween(at('2024-02-29T00:00:00Z'), at('2025-02-28T00:00:00Z'));
    expect([t.years, t.months, t.days]).toEqual([1, 0, 0]);
    expect(t.totalDays).toBe(365);
  });

  it('MANDATORY: a join day longer than the next month does not go negative', () => {
    /*
     * ★ THE CASE THAT BROKE THE FIRST IMPLEMENTATION ★
     *
     * Subtracting the fields and borrowing gives 2 - 31 = -29, then +28 for February = MINUS ONE
     * day. One month takes 31 January to 28 February (clamped), and 28 February to 2 March is two
     * days. Anyone who joined on the 29th, 30th or 31st hits this.
     */
    const t = tenureBetween(at('2025-01-31T00:00:00Z'), at('2025-03-02T00:00:00Z'));
    expect([t.years, t.months, t.days]).toEqual([0, 1, 2]);
  });

  it('totalDays is exact, and is what sorting uses', () => {
    expect(tenureBetween(at('2026-01-01T00:00:00Z'), at('2026-01-11T00:00:00Z')).totalDays).toBe(10);
  });

  it('MANDATORY: a future join date is never a negative tenure', () => {
    // Clock skew between the bot host and the web host. "-3 months in squadron" is worse than zero.
    const t = tenureBetween(at('2026-09-01T00:00:00Z'), at('2026-08-01T00:00:00Z'));
    expect(t.totalDays).toBe(0);
    expect(t.years).toBe(0);
    expect(t.months).toBe(0);
  });
});

describe('formatTenure', () => {
  it('says years and months, and stops there', () => {
    expect(formatTenure(tenureBetween(at('2024-03-03T00:00:00Z'), at('2026-06-17T00:00:00Z')))).toBe(
      '2 years 3 months',
    );
  });

  it('drops a zero unit rather than printing it', () => {
    expect(formatTenure(tenureBetween(at('2025-06-01T00:00:00Z'), at('2026-06-01T00:00:00Z')))).toBe('1 year');
  });

  it('months and days for under a year', () => {
    expect(formatTenure(tenureBetween(at('2026-04-01T00:00:00Z'), at('2026-06-15T00:00:00Z')))).toBe(
      '2 months 14 days',
    );
  });

  it('days for a new recruit, because the days are the answer', () => {
    expect(formatTenure(tenureBetween(at('2026-07-25T00:00:00Z'), at('2026-08-01T00:00:00Z')))).toBe('7 days');
  });

  it('MANDATORY: says "today", not "0 days"', () => {
    // A zero in a table reads as missing data. It is the most precise answer there is.
    expect(formatTenure(tenureBetween(at('2026-08-01T09:00:00Z'), at('2026-08-01T17:00:00Z')))).toBe('today');
  });

  it('singular units are singular', () => {
    expect(formatTenure({ years: 1, months: 1, days: 0, totalDays: 396 })).toBe('1 year 1 month');
    expect(formatTenure({ years: 0, months: 1, days: 1, totalDays: 32 })).toBe('1 month 1 day');
  });
});

describe('tenureFrom', () => {
  it('returns null rather than a guess when there is no date', () => {
    // Everybody who has left the squadron. The column says so; it does not invent a tenure.
    expect(tenureFrom(null)).toBeNull();
  });

  it('returns null for an unparseable date', () => {
    expect(tenureFrom('not a date')).toBeNull();
  });

  it('formats an ISO string against a fixed now', () => {
    expect(tenureFrom('2025-08-01T00:00:00Z', at('2026-08-01T00:00:00Z').getTime())).toBe('1 year');
  });
});
