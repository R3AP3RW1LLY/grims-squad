import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlayingNow } from './roster-card';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(HERE, 'roster-card.tsx'), 'utf8');

/**
 * The roster card.
 *
 * ★ TWO THINGS IT GOT WRONG, BOTH REPORTED FROM A REAL SCREEN ★
 *
 * It said "last flew today" for a session fifteen hours earlier — elapsed
 * 24-hour periods labelled with calendar words — and it had no way to say
 * somebody was playing right now.
 */

const NOW = new Date('2026-07-28T17:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('playing now', () => {
  it('MANDATORY: is true while the journal is still being written', () => {
    expect(isPlayingNow(ago(30_000), NOW)).toBe(true);
  });

  it('MANDATORY: goes quiet a few minutes after they stop', () => {
    /*
     * The companion polls every twenty seconds, so a live session refreshes
     * this constantly. The window has to cover a slow poll and a loading
     * screen without leaving somebody marked online an hour after they quit —
     * which is the failure that makes a presence indicator worthless.
     */
    expect(isPlayingNow(ago(4 * 60_000), NOW)).toBe(true);
    expect(isPlayingNow(ago(6 * 60_000), NOW)).toBe(false);
  });

  it('is false for somebody who has never run the app', () => {
    expect(isPlayingNow(null, NOW)).toBe(false);
  });

  it('MANDATORY: a future timestamp does not read as playing', () => {
    // A clock skewed ahead would otherwise mark somebody online permanently,
    // and nothing would ever clear it.
    expect(isPlayingNow(new Date(NOW + 60 * 60_000).toISOString(), NOW)).toBe(false);
  });

  it('survives an unparseable value', () => {
    expect(isPlayingNow('not a date', NOW)).toBe(false);
  });
});

describe('how long ago they flew', () => {
  it('MANDATORY: reports HOURS, not "today"', () => {
    /*
     * ★ THE BUG ★
     *
     * It computed elapsed 24-hour periods and labelled them with CALENDAR
     * words, so anything under a day became "today". A session fifteen hours
     * earlier read as "today" even though it was the previous evening where
     * the member lives — and "today" is a claim about a calendar, not about
     * elapsed time.
     */
    expect(source).not.toMatch(/return 'today'/);
    expect(source).not.toMatch(/return 'yesterday'/);
    expect(source).toMatch(/hours ago/);
  });

  it('MANDATORY: playing now takes precedence over last flew', () => {
    // They answer the same question and the live one is strictly better.
    // Showing "14 hours ago" beside a green dot would be two answers.
    const dl = source.slice(source.indexOf('<dl'), source.indexOf('</dl>'));
    expect(dl.indexOf('Playing now')).toBeLessThan(dl.indexOf('Last flew'));
  });

  it('MANDATORY: presence is shown with a WORD, not only a colour', () => {
    // A coloured dot alone is unreadable to anybody who cannot distinguish it,
    // and meaningless to a screen reader.
    expect(source).toContain('Playing now');
    expect(source).toMatch(/aria-hidden="true"[\s\S]{0,120}rounded-full/);
  });
});

describe('the local clock', () => {
  it('MANDATORY: carries AM or PM', () => {
    // 24-hour time on a roster of people in six countries is one more thing to
    // convert in your head at the moment you are trying not to.
    expect(source).toContain('dayPeriod');
    expect(source).toContain('hour12: true');
  });
});
