import { describe, expect, it } from 'vitest';
import { positionAge } from './commander-position.service.js';

/**
 * How old a position is, said in units somebody flies in.
 *
 * ★ THE WHOLE FEATURE IS THE CAVEAT ★
 *
 * A position from six hours ago is useful. A position from three weeks ago looks exactly as
 * authoritative and will send somebody shopping four hundred light years from where they are.
 * Measuring from the second one silently is worse than not knowing at all — the member has no way
 * to tell they are being given an answer to a question about somewhere they left.
 */

const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);
const ago = (ms: number): Date => new Date(NOW - ms);

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('how long ago somebody was there', () => {
  it('counts in minutes, then hours, then days, then months', () => {
    expect(positionAge(ago(30_000), NOW).text).toBe('just now');
    expect(positionAge(ago(20 * MIN), NOW).text).toBe('20 minutes ago');
    expect(positionAge(ago(3 * HOUR), NOW).text).toBe('3 hours ago');
    expect(positionAge(ago(2 * DAY), NOW).text).toBe('2 days ago');
    expect(positionAge(ago(70 * DAY), NOW).text).toBe('2 months ago');
  });

  it('says one hour rather than 1 hours', () => {
    expect(positionAge(ago(HOUR), NOW).text).toBe('1 hour ago');
    expect(positionAge(ago(DAY), NOW).text).toBe('1 day ago');
  });

  it('★ CALLS IT STALE FROM A DAY, NOT FROM A WEEK ★', () => {
    /*
     * A day is the line because it is the line in the game. Somebody who last docked six hours ago
     * is almost certainly still in the same region and a 50 ly search around them is meaningful.
     * Somebody who last docked yesterday may have crossed the bubble, and a page measuring
     * distances from there needs to say so rather than quietly present them.
     */
    expect(positionAge(ago(23 * HOUR), NOW).stale).toBe(false);
    expect(positionAge(ago(25 * HOUR), NOW).stale).toBe(true);
    expect(positionAge(ago(40 * DAY), NOW).stale).toBe(true);
  });

  it('does not go backwards on a clock that has run ahead', () => {
    /*
     * Journals carry the game's timestamp and the app uploads later, so a machine with a fast clock
     * can produce an event stamped in the future. "in -3 minutes" is nonsense on a page; "just now"
     * is both true enough and harmless.
     */
    expect(positionAge(new Date(NOW + HOUR), NOW).text).toBe('just now');
    expect(positionAge(new Date(NOW + HOUR), NOW).stale).toBe(false);
  });
});
