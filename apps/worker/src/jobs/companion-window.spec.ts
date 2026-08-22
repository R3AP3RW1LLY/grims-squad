import { describe, expect, it, vi } from 'vitest';
import { REFRESH_HOURS } from '@grims/shared';
import {
  COMPANION_WINDOW_MINUTES,
  closeCompanionWindow,
  type CompanionWindowStore,
} from './companion-window.js';
import { RESIDENT } from '../scheduler.js';

/**
 * Making a push-driven feed legible on a page built for cron jobs.
 *
 * ★ SQUADRON OWNER, 2026-08-22 ★
 *
 * "this is not scheduled to run at all: Systems our members have flown to -- we need this to work
 * just like the realtime ingestion of market prices please so that this is a real time living
 * ingestion service! make it work exactly like the worker we built for: Live markets"
 *
 * ★ IT WAS ALREADY REAL-TIME. IT COULD NOT SAY SO ★
 *
 * Companion systems are written the instant a member jumps: their app pushes the journal event and
 * `recordSystemSighting` writes the row. There is no job to schedule and never was — which is why
 * `companion` was added to the scheduler's RESIDENT list, so nothing tries to "start" it.
 *
 * But that is only half of what `eddn` has. Live markets is equally push-driven and reports anyway,
 * by closing a REPORTING WINDOW every fifteen minutes. Without that half, the training page renders
 * "Never run", which on a page whose whole purpose is showing what works reads as broken.
 *
 * ★ WHY A COMPLETED WINDOW EACH TIME, RATHER THAN OPEN-THEN-CLOSE ★
 *
 * The collector opens an unfinished row and closes it later, so a live window shows a heartbeat.
 * That costs it `reconcileOpenWindows`: a crash between open and close strands an unfinished row and
 * the page reports a stall for a process that is fine.
 *
 * This writes one already-closed row per window instead. There is never an open row to strand, so
 * that entire failure mode does not exist here. The cost is no mid-window heartbeat, which does not
 * matter when a window is fifteen minutes and the alarm is an hour.
 */

const NOW = new Date('2026-08-22T23:00:00.000Z');

function store(over: Partial<CompanionWindowStore> = {}): CompanionWindowStore {
  return {
    countSince: vi.fn(async () => 0),
    writeWindow: vi.fn(async () => undefined),
    lastWindowEnd: vi.fn(async () => null),
    ...over,
  };
}

describe('the companion reporting window', () => {
  it('★ MANDATORY: a quiet window still closes ★', async () => {
    /*
     * The whole point. Members do not fly at 4am, and a window that only closed when somebody was
     * flying would leave the page saying "Never run" all night — indistinguishable from the pairing
     * path being broken, which is the one thing this exists to make visible.
     *
     * Zero is a real answer. Silence is not.
     */
    const s = store({ countSince: vi.fn(async () => 0) });

    await closeCompanionWindow(s, NOW);

    expect(s.writeWindow).toHaveBeenCalledTimes(1);
    expect(vi.mocked(s.writeWindow).mock.calls[0]?.[0].rows).toBe(0);
  });

  it('reports what members actually flew to', async () => {
    const s = store({ countSince: vi.fn(async () => 42) });

    await closeCompanionWindow(s, NOW);

    expect(vi.mocked(s.writeWindow).mock.calls[0]?.[0].rows).toBe(42);
  });

  it('★ MANDATORY: counts from the last window, not from a fixed span ★', async () => {
    /*
     * If the worker was down for three hours, the first window after it comes back covers those
     * three hours. Counting a flat fifteen minutes would silently drop everything members flew to
     * while nobody was watching — and the count is the only evidence the feed is alive.
     */
    const gap = new Date(NOW.getTime() - 3 * 60 * 60_000);
    const s = store({ lastWindowEnd: vi.fn(async () => gap) });

    await closeCompanionWindow(s, NOW);

    expect(s.countSince).toHaveBeenCalledWith(gap, NOW);
    expect(vi.mocked(s.writeWindow).mock.calls[0]?.[0].startedAt).toEqual(gap);
  });

  it('falls back to one window when nothing has ever been recorded', async () => {
    // First run on a fresh database: there is no previous window to measure from.
    const s = store({ lastWindowEnd: vi.fn(async () => null) });

    await closeCompanionWindow(s, NOW);

    const expected = new Date(NOW.getTime() - COMPANION_WINDOW_MINUTES * 60_000);
    expect(s.countSince).toHaveBeenCalledWith(expected, NOW);
  });

  it('★ MANDATORY: several windows fit inside the overdue alarm ★', () => {
    /*
     * The two numbers have to be read together, so the test reads them together rather than
     * hard-coding either. If the window ever grew past the alarm, the source would be permanently
     * overdue while working perfectly — the trap EDDN_WINDOW_MINUTES documents, and the reason it
     * refuses anything over sixty minutes.
     */
    const alarmMinutes = REFRESH_HOURS.companion * 60;

    expect(COMPANION_WINDOW_MINUTES).toBeGreaterThan(0);
    expect(
      alarmMinutes / COMPANION_WINDOW_MINUTES,
      'at least three windows must be expected before the page cries overdue',
    ).toBeGreaterThanOrEqual(3);

    /*
     * ★ AND THE ALARM MUST BE AS SHARP AS LIVE MARKETS' ★
     *
     * The owner asked for this to work "exactly like the worker we built for: Live markets", so it
     * is held to that source's threshold rather than to a number of its own.
     *
     * Written first with only the ratio check above, which a 24-hour alarm passes comfortably —
     * 96 windows fit in a day. It would also mean the pairing path could be dead from breakfast to
     * bedtime with the page looking content, which is not an alarm, it is a decoration.
     */
    expect(
      REFRESH_HOURS.companion,
      'companion must go overdue at least as fast as live markets does',
    ).toBeLessThanOrEqual(REFRESH_HOURS.eddn);
  });

  it('★ MANDATORY: companion is never SCHEDULED, only reported on ★', () => {
    /*
     * The two halves of the owner's request pull opposite ways and both must hold: there is no
     * ingest to start (it is pushed by members' apps), AND it must still report that it is alive.
     *
     * Dropping it from RESIDENT would have the daemon try to start a "companion ingest" every hour
     * now that the alarm is 1 — starting nothing, for ever, which is exactly what that list exists
     * to prevent.
     */
    expect(RESIDENT).toContain('companion');
  });

  it('a failed count does not stop the next window', async () => {
    /*
     * Reporting must never be able to take down the thing it reports on, nor wedge itself. A window
     * that throws would kill the interval and the page would silently freeze on an old timestamp.
     */
    const s = store({
      countSince: vi.fn(async () => {
        throw new Error('database went away');
      }),
    });

    await expect(closeCompanionWindow(s, NOW)).resolves.toBeUndefined();
    expect(s.writeWindow).not.toHaveBeenCalled();
  });
});
