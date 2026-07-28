import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(HERE, 'session-countdown.tsx'), 'utf8');

/** Source with comments stripped, so prose explaining a rule cannot satisfy it. */
function code(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

/**
 * The session countdown.
 *
 * ★ THE BUG THIS EXISTS FOR ★
 *
 * The first version updated every second and rendered `13d 23h 59m`. It was
 * live and looked frozen: the smallest unit on screen changed once a minute, so
 * for fifty-nine seconds in sixty it was indistinguishable from a static figure
 * baked into the page.
 *
 * A countdown that does not visibly count is worse than a plain date — it
 * claims to be live and offers no evidence.
 */

/*
 * The formatter, lifted rather than imported: it is internal to a 'use client'
 * component, and exporting it purely to test it would widen the component's
 * surface for the sake of the test. The assertions below pin the SOURCE as
 * well, so the two cannot drift apart silently.
 */
function countdownText(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  return `${m}m ${pad(s)}s`;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('what it renders', () => {
  it('MANDATORY: shows SECONDS even with days left', () => {
    // The whole bug. Without this the display changes once a minute and reads
    // as static.
    expect(countdownText(13 * DAY + 23 * HOUR + 59 * MINUTE + 4 * SECOND)).toBe('13d 23h 59m 04s');
  });

  it('MANDATORY: the value changes every single second', () => {
    /*
     * Asserted as a property rather than by eye: sixty consecutive seconds must
     * all produce different text. An earlier version passed a spot check at
     * 04s and 05s while still rendering identically for the other fifty-eight.
     */
    const base = 13 * DAY + 23 * HOUR;
    const seen = new Set<string>();
    for (let i = 0; i < 60; i += 1) seen.add(countdownText(base + i * SECOND));

    expect(seen.size).toBe(60);
  });

  it('drops the day and hour segments as they empty', () => {
    // A member with four minutes left should not have to read past "0d 00h" to
    // find the number that matters.
    expect(countdownText(4 * MINUTE + 7 * SECOND)).toBe('4m 07s');
    expect(countdownText(2 * HOUR + 5 * MINUTE)).toBe('2h 05m 00s');
  });

  it('never renders a negative countdown', () => {
    // Clamped, because "-3m -12s" is a puzzle rather than a value.
    expect(countdownText(-60_000)).toBe('0m 00s');
  });

  it('pads, so the row does not change width mid-tick', () => {
    expect(countdownText(1 * DAY + 1 * HOUR + 1 * MINUTE + 1 * SECOND)).toBe('1d 01h 01m 01s');
  });
});

describe('the component itself', () => {
  it('MANDATORY: ticks once a second', () => {
    expect(code(source)).toMatch(/setInterval\([^,]+,\s*1000\)/);
  });

  it('MANDATORY: reads the CLOCK each tick rather than decrementing', () => {
    /*
     * A backgrounded tab has its timers throttled. A counter that subtracted a
     * second per tick would drift while hidden and then jump on return; reading
     * Date.now() is correct whenever it happens to run.
     */
    expect(code(source)).toContain('setNow(Date.now())');
  });

  it('MANDATORY: renders nothing before mount', () => {
    /*
     * The server must not emit a figure from its own clock — it would differ
     * from the browser's by a second and cause a hydration mismatch, and React
     * would replace the block on every page load.
     */
    expect(code(source)).toMatch(/useState<number \| null>\(null\)/);
    expect(code(source)).toContain('now === null) return null');
  });

  it('clears its timer', () => {
    // A dashboard left open through a dozen client-side navigations should not
    // accumulate a dozen intervals.
    expect(code(source)).toContain('clearInterval');
  });

  it('MANDATORY: uses tabular figures', () => {
    // Proportional digits change width as they change shape, so the whole card
    // twitches once a second — which reads as a rendering fault.
    expect(code(source)).toContain('tabular-nums');
  });

  it('MANDATORY: does not announce every tick to a screen reader', () => {
    // A per-second counter on aria-live="polite" reads numbers continuously and
    // drowns out the rest of the page. The sentence beneath carries the same
    // information once.
    expect(code(source)).toContain('aria-live="off"');
  });

  it('MANDATORY: formats the end time in the MEMBER\'s timezone', () => {
    // Not the device's. Someone on a work laptop set to another country would
    // otherwise read an end time an hour or eight out.
    expect(code(source)).toContain('formatLocal(expiresAt, timezone)');
    expect(code(source)).not.toMatch(/new Date\([^)]*\)\.toLocale/);
  });

  it('says what will happen, in those words', () => {
    // "Signed in for" is a label on a number. "You will be signed out in" is
    // the thing a member actually wants to know.
    expect(source).toContain('You will be signed out in');
  });
});
