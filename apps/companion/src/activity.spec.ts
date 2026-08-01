import { describe, expect, it } from 'vitest';
import { ACTIVITY_MAX, append, bytes, gameLine, linesFor } from './activity.js';
import type { WatchOutcome } from './watcher.js';

/**
 * The feature is the FILTER, not the list.
 *
 * A log that records every pass looks identical in a screenshot and is useless in use: the watcher
 * runs every twenty seconds, Elite writes nothing during most of them, and three useful lines an
 * hour would sit under a hundred and seventy saying nothing happened.
 */

const QUIET: WatchOutcome = {
  gameRunning: false,
  filesRead: 0,
  newFilesRead: 0,
  txBytes: 0,
  rxBytes: 0,
  sent: 0,
  duplicates: 0,
  refused: {},
  unauthorised: false,
  error: null,
};

const AT = 1_754_000_000_000;

describe('linesFor', () => {
  it('MANDATORY: says nothing about a pass where nothing happened', () => {
    expect(linesFor(QUIET, AT)).toEqual([]);
  });

  it('reports a send, with where it came from and what it cost', () => {
    const lines = linesFor({ ...QUIET, sent: 42, filesRead: 1, txBytes: 4_300 }, AT);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('42 events from your journal · 4.2 KB sent');
  });

  it('pluralises the journals it read', () => {
    const lines = linesFor({ ...QUIET, sent: 9, filesRead: 3, txBytes: 900 }, AT);
    expect(lines[0]?.text).toContain('from 3 journals');
  });

  it('MANDATORY: stays quiet about duplicates when real events went too', () => {
    /*
     * The app re-reads the tail of a growing file every pass, so a few already-seen events is the
     * normal healthy case. Reported beside a real send it is noise; reported alone it answers "why
     * is the counter not moving".
     */
    const withSend = linesFor({ ...QUIET, sent: 5, duplicates: 30, filesRead: 1 }, AT);
    expect(withSend.some((l) => l.text.includes('already had'))).toBe(false);

    const alone = linesFor({ ...QUIET, duplicates: 30 }, AT);
    expect(alone[0]?.text).toBe('30 events the squadron already had');
  });

  it('names what was discarded and why, as a warning', () => {
    const lines = linesFor({ ...QUIET, refused: { combat: 4, exploration: 2 } }, AT);
    expect(lines[0]?.level).toBe('warn');
    expect(lines[0]?.text).toContain('combat (4)');
    expect(lines[0]?.text).toContain('exploration (2)');
  });

  it('MANDATORY: puts a failure first, even on a pass that also sent', () => {
    // A partial upload is both. The error is why somebody opened the panel, so it goes on top.
    const lines = linesFor({ ...QUIET, sent: 10, filesRead: 1, error: 'ETIMEDOUT' }, AT);
    expect(lines[0]?.level).toBe('error');
    expect(lines[0]?.text).toContain('ETIMEDOUT');
    expect(lines[1]?.text).toContain('10 events');
  });

  it('says plainly when the device has been disconnected', () => {
    const lines = linesFor({ ...QUIET, unauthorised: true }, AT);
    expect(lines[0]?.level).toBe('error');
    expect(lines[0]?.text).toContain('Sign in again');
  });

  it('does not report reading the same growing file over and over', () => {
    // filesRead counts the current journal on every pass; only newFilesRead is news.
    expect(linesFor({ ...QUIET, filesRead: 1 }, AT)).toEqual([]);
    expect(linesFor({ ...QUIET, filesRead: 1, newFilesRead: 1 }, AT)[0]?.text).toContain(
      '1 new journal picked up',
    );
  });
});

describe('gameLine', () => {
  it('MANDATORY: reports the transition, never the state', () => {
    /*
     * `gameRunning` is a boolean on every pass. Logging its value would produce three lines a
     * minute for as long as somebody plays.
     */
    expect(gameLine(false, false, AT)).toBeNull();
    expect(gameLine(true, true, AT)).toBeNull();
    expect(gameLine(false, true, AT)?.text).toContain('is running');
    expect(gameLine(true, false, AT)?.text).toContain('closed');
  });
});

describe('append', () => {
  it('keeps the newest and drops the oldest', () => {
    const many = Array.from({ length: ACTIVITY_MAX + 50 }, (_, i) => ({
      at: AT + i,
      level: 'info' as const,
      text: `line ${i}`,
    }));
    const out = append([], many);
    expect(out).toHaveLength(ACTIVITY_MAX);
    expect(out[out.length - 1]?.text).toBe(`line ${ACTIVITY_MAX + 49}`);
  });

  it('returns the same log untouched when there is nothing to add', () => {
    // A quiet pass must not churn the array — the renderer re-draws on identity change.
    const log = [{ at: AT, level: 'info' as const, text: 'x' }];
    expect(append(log, [])).toBe(log);
  });
});

describe('bytes', () => {
  it('reads the way people say sizes', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(900)).toBe('900 B');
    expect(bytes(4_300)).toBe('4.2 KB');
    expect(bytes(15_000_000)).toBe('14 MB');
  });
});
