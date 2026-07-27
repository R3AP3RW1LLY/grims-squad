import { describe, it, expect } from 'vitest';
import { dateRange } from './admin.controller.js';

/**
 * P1.7: "The audit log viewer filters by actor, action, target and date."
 *
 * The date half has one edge that gets it wrong in a way nobody notices: an
 * end date treated as midnight excludes the entire day the person asked about.
 */
describe('audit date filters', () => {
  it('MANDATORY: a bare end DATE covers the whole of that day', () => {
    // Somebody filtering "until 2026-07-27" means the 27th INCLUDED. Treating
    // it as 00:00 silently drops everything that happened that day — which is
    // the most recent activity, and usually exactly what they were looking for.
    const { until } = dateRange(undefined, '2026-07-27');
    expect(until?.toISOString()).toBe('2026-07-27T23:59:59.999Z');
  });

  it('leaves a full timestamp exactly as given', () => {
    // An explicit instant is a deliberate choice and must not be widened.
    const { until } = dateRange(undefined, '2026-07-27T12:00:00.000Z');
    expect(until?.toISOString()).toBe('2026-07-27T12:00:00.000Z');
  });

  it('parses a start date as the beginning of that day', () => {
    expect(dateRange('2026-07-01', undefined).since?.toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
  });

  it('ignores unparseable dates rather than erroring', () => {
    // A stray query string should not 400 a dashboard. There is no security
    // consequence: an ignored filter is a WIDER result set shown to someone who
    // already holds MEMBER_MANAGE, not a narrower one that hides something.
    expect(dateRange('not-a-date', 'nonsense')).toEqual({});
  });

  it('handles both bounds together', () => {
    const r = dateRange('2026-07-01', '2026-07-31');
    expect(r.since?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(r.until?.toISOString()).toBe('2026-07-31T23:59:59.999Z');
  });

  it('returns nothing when neither bound is supplied', () => {
    expect(dateRange(undefined, undefined)).toEqual({});
    expect(dateRange('', '')).toEqual({});
  });
});
